// app/lib/services/aiService.ts
import { createClient } from '@supabase/supabase-js';

// 1. ตั้งค่า Supabase (ดึงจาก .env)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// 2. ตั้งค่า n8n URL (ดึงจาก .env)
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'YOUR_N8N_URL_HERE'; 

export const AIService = {
  async processUserChat(message: string, userId: string) {
    try {
      const validUserId = userId || 'anonymous'; 

      // --- Step 1: ดึงประวัติเก่าจาก Supabase ---
      const { data: historyData, error: fetchError } = await supabase
        .from('chat_history')
        .select('role, content')
        .eq('user_id', validUserId)
        .order('created_at', { ascending: false }) 
        .limit(6); // ดึง 6 ข้อความล่าสุด (ถาม-ตอบ 3 คู่ล่าสุด)

      if (fetchError) console.error('Error fetching history:', fetchError);
      
      // พลิกกลับให้เรียงจากเก่าไปใหม่
      const chatHistory = historyData ? historyData.reverse() : [];

      // --- Step 2: บันทึก "คำถามใหม่" ลง Supabase ---
      await supabase.from('chat_history').insert([
        { user_id: validUserId, role: 'user', content: message }
      ]);

      // --- Step 3: ยิงไปหา n8n พร้อมแนบประวัติเก่าไปด้วย ---
      console.log(`Sending to n8n... Msg: ${message}, User: ${validUserId}`);
      
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: message, 
          userId: validUserId,
          history: chatHistory // ✅ แนบประวัติส่งไปให้ n8n ด้วย!
        }), 
      });

      if (!response.ok) {
        throw new Error(`n8n Error! Status: ${response.status}`);
      }

      const data = await response.json();
      
      // ดึงคำตอบจาก n8n
      const aiReply = data.reply || data.text || data.output || "ขออภัย ระบบขัดข้อง";

      // --- Step 4: บันทึก "คำตอบ AI" ลง Supabase ---
      await supabase.from('chat_history').insert([
        { user_id: validUserId, role: 'assistant', content: aiReply }
      ]);

      return aiReply;

    } catch (error) {
      console.error("AIService Error:", error);
      throw error;
    }
  },
};