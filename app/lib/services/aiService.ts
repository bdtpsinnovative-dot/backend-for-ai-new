// app/lib/services/aiService.ts
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- ตั้งค่า Supabase ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// --- ตั้งค่า Gemini API ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || ''); 

// 🤖 ตั้งค่า Model พร้อม "คำสั่งชี้ขาด" (System Instruction)
const model = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-flash', // หรือ gemini-2.5-flash ถ้าอัปเดตแล้ว
  systemInstruction: "คุณคือ WallCraft AI ผู้เชี่ยวชาญด้านการออกแบบและการติดตั้งวอลเปเปอร์ หน้าที่ของคุณคือตอบคำถามลูกค้าอย่างสุภาพและเป็นมืออาชีพ โดยอ้างอิงจาก 'ข้อมูลสินค้าอ้างอิง' ที่แนบไปให้เท่านั้น หากข้อมูลที่ให้มาไม่มีคำตอบ ให้ตอบว่า 'ขออภัยครับ ทางเราไม่มีข้อมูลในส่วนนี้ โปรดติดต่อพนักงานฝ่ายขาย' ห้ามแต่งเติมข้อมูลสินค้าเองเด็ดขาด",
}); 

export const AIService = {
  async processUserChat(message: string, userId: string) {
    try {
      const validUserId = userId || 'anonymous'; 

      // --- Step 1: ดึงข้อมูลความรู้ (Product Knowledge) จาก Supabase ---
      // *หมายเหตุ: ถ้าข้อมูลในตารางมีเยอะมาก อนาคตอาจจะต้องทำ Text Search 
      // แต่วันนี้เราดึงมาแบบครอบคลุมก่อนครับ (เอามา 10 รายการล่าสุด หรือค้นหาคำคล้าย)
      const { data: knowledgeData, error: kbError } = await supabase
        .from('product_knowledge')
        .select('series_name, question, answer, recommendation, note')
        // .ilike('question', `%${message}%`) // 👈 ถ้าอยากให้ค้นหาเฉพาะเจาะจง เปิดคอมเมนต์บรรทัดนี้ได้ครับ
        .limit(10); 

      if (kbError) console.error('Error fetching knowledge:', kbError);

      // แปลงข้อมูลตารางให้อยู่ในรูปแบบ Text ยาวๆ เพื่อให้ AI อ่านเข้าใจง่าย
      let knowledgeContext = "";
      if (knowledgeData && knowledgeData.length > 0) {
        knowledgeContext = knowledgeData.map((item, index) => 
          `ข้อมูลที่ ${index + 1}: ซีรีส์ ${item.series_name || '-'}, คำถามที่พบบ่อย: ${item.question || '-'}, คำตอบ: ${item.answer || '-'}, ข้อแนะนำ: ${item.recommendation || '-'}, หมายเหตุ: ${item.note || '-'}`
        ).join('\n');
      } else {
        knowledgeContext = "ไม่มีข้อมูลสินค้าเฉพาะเจาะจงในระบบขณะนี้";
      }

      // --- Step 2: ดึงประวัติเก่าจาก Supabase (เหมือนเดิม) ---
      const { data: historyData, error: fetchError } = await supabase
        .from('chat_history')
        .select('role, content')
        .eq('user_id', validUserId)
        .order('created_at', { ascending: false }) 
        .limit(6);

      const rawHistory = historyData ? historyData.reverse() : [];
      const formattedHistory = rawHistory.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      // --- Step 3: บันทึก "คำถามใหม่" ลง Supabase ---
      await supabase.from('chat_history').insert([
        { user_id: validUserId, role: 'user', content: message }
      ]);

      // --- Step 4: รวมร่างคำถาม + โพยความรู้ ส่งให้ AI ---
      // เราจะเอาข้อมูลที่เราดึงมา แอบยัดไว้ในคำถามของ User ครับ
      const finalPrompt = `
      ข้อมูลสินค้าอ้างอิงจากฐานข้อมูล:
      ${knowledgeContext}

      ----------------
      คำถามจากลูกค้า: "${message}"
      `;

      console.log(`Sending to Gemini with Product Knowledge Context...`);
      
      const chat = model.startChat({ history: formattedHistory });
      
      // ส่งคำถามที่แนบโพยข้อมูลไปให้ AI
      const result = await chat.sendMessage(finalPrompt);
      const aiReply = result.response.text();

      // --- Step 5: บันทึก "คำตอบ AI" ลง Supabase ---
      await supabase.from('chat_history').insert([
        { user_id: validUserId, role: 'assistant', content: aiReply }
      ]);

      return aiReply;

    } catch (error) {
      console.error("Gemini API Error:", error);
      throw error;
    }
  },
};