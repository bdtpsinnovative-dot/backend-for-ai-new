// app/lib/services/aiService.ts
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- ตั้งค่า Supabase ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// --- ตั้งค่า Gemini API ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || ''); 

// 🌟 ใช้โมเดลมาตรฐานที่ชัวร์ที่สุด
const MODEL_NAME = 'gemini-2.5-flash';

const model = genAI.getGenerativeModel({ 
  model: MODEL_NAME,
  systemInstruction: `คุณคือ WallCraft AI ผู้เชี่ยวชาญด้านการออกแบบและการติดตั้งวอลเปเปอร์
หน้าที่ของคุณคือตอบคำถามลูกค้าอย่างสุภาพ เป็นมิตร และดูเป็นมืออาชีพ 

กฎในการตอบคำถาม:
1. ใช้ข้อมูลจาก "ข้อมูลสินค้าอ้างอิง" ที่ส่งไปให้เป็นหลักในการตอบ
2. คุณสามารถสรุป เรียบเรียง หรือจับใจความจากข้อมูลอ้างอิง เพื่อให้คำตอบดูเป็นธรรมชาติและตรงคำถามลูกค้าได้
3. หากลูกค้าถามเรื่องทั่วไปเกี่ยวกับการตกแต่งผนัง คุณสามารถใช้ความรู้ทั่วไปของคุณแนะนำได้
4. **สำคัญมาก:** ให้ตอบว่า "ขออภัยครับ ทางเราไม่มีข้อมูลในส่วนนี้..." เฉพาะในกรณีที่ลูกค้าถามเจาะจงถึง "สเปคสินค้า ราคา หรือเงื่อนไข" ที่ไม่มีระบุไว้ในข้อมูลอ้างอิงเลยจริงๆ เท่านั้น
5. ห้ามแต่งเติมสเปคสินค้า, ราคา, หรือระยะเวลาการผลิตเอาเองเด็ดขาด`,
});

export const AIService = {
  async processUserChat(message: string, userId: string) {
    try {
      const validUserId = userId || 'anonymous'; 

      // --- Step 1: สกัดคีย์เวิร์ด และ ดึงโพย ---
      const keywords = message.split(/\s+/).filter(word => word.length > 2);
      let searchQuery = supabase.from('product_knowledge').select('series_name, question, answer, recommendation, note');
      
      if (keywords.length > 0) {
        const orConditions = keywords.map(kw => `series_name.ilike.%${kw}%,question.ilike.%${kw}%,answer.ilike.%${kw}%`).join(',');
        searchQuery = searchQuery.or(orConditions);
      }

      const { data: knowledgeData, error: kbError } = await searchQuery.limit(3); 
      if (kbError) console.error('Error fetching knowledge:', kbError);
      
      console.log("🔍 โพยที่หาเจอ:", knowledgeData?.length, "รายการ");

      let knowledgeContext = "";
      if (knowledgeData && knowledgeData.length > 0) {
        knowledgeContext = knowledgeData.map((item, index) => 
          `[ข้อมูลที่ ${index + 1}] ซีรีส์: ${item.series_name || '-'} | คำถาม: ${item.question || '-'} | คำตอบ: ${item.answer || '-'} | ข้อแนะนำ: ${item.recommendation || '-'} | หมายเหตุ: ${item.note || '-'}`
        ).join('\n');
      } else {
        knowledgeContext = "ไม่มีข้อมูลสินค้าเฉพาะเจาะจงในระบบที่ตรงกับคำถามนี้";
      }

      // --- Step 2: ดึงประวัติเก่า ---
      const { data: historyData } = await supabase
        .from('chat_history')
        .select('role, content')
        .eq('user_id', validUserId)
        .order('created_at', { ascending: false }) 
        .limit(4);

      const rawHistory = historyData ? historyData.reverse() : [];
      const formattedHistory = rawHistory.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      // กรองประวัติแชท บังคับให้ข้อความแรกสุดต้องเป็น role 'user'
      let safeHistory = [...formattedHistory];
      while (safeHistory.length > 0 && safeHistory[0].role !== 'user') {
        safeHistory.shift(); 
      }

      // --- Step 3: บันทึกคำถาม ---
      await supabase.from('chat_history').insert([
        { user_id: validUserId, role: 'user', content: message }
      ]);

      // --- Step 4: ส่งหา AI ---
      const finalPrompt = `ข้อมูลอ้างอิง:\n${knowledgeContext}\n\nคำถาม: "${message}"`;
      console.log(`Sending to Gemini with Context...`);
      
      try {
        const chat = model.startChat({ history: safeHistory });
        const result = await chat.sendMessage(finalPrompt);
        const aiReply = result.response.text();

        // --- Step 5: บันทึกคำตอบ AI ---
        await supabase.from('chat_history').insert([
          { user_id: validUserId, role: 'assistant', content: aiReply }
        ]);

        return aiReply;

      } catch (apiError: any) {
        // 🌟 ดักจับกรณี Quota เต็ม (429) จะได้หน้าไม่พัง
        if (apiError.status === 429 || apiError.message?.includes('429')) {
          console.warn("⚠️ Gemini Quota Exceeded! Sending Mock Response.");
          
          // ดึงคำตอบจากโพยบรรทัดแรกมาตอบแทนไปก่อน
          let fallbackReply = "ขออภัยครับ ตอนนี้ระบบ AI มีผู้ใช้งานจำนวนมาก (โควต้าทดสอบเต็ม) กรุณารอสักครู่แล้วลองใหม่ครับ";
          if (knowledgeData && knowledgeData.length > 0 && knowledgeData[0].answer) {
             fallbackReply = `(โหมดสำรอง) จากฐานข้อมูล: ${knowledgeData[0].answer}`;
          }
          
          return fallbackReply;
        }
        throw apiError; // ถ้า Error อื่นๆ โยนทิ้งไปให้ Catch ตัวนอกจัดการ
      }

    } catch (error) {
      console.error("Critical API Error:", error);
      return "เกิดข้อผิดพลาดทางเทคนิคในการเชื่อมต่อระบบ AI ครับ โปรดลองใหม่อีกครั้ง";
    }
  },
};