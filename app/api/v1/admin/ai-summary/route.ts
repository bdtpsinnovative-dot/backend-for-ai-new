import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const AI_API_KEY = process.env.GEMINI_API_KEY;

let aiCache: { [key: string]: { data: any; timestamp: number } } = {};
const CACHE_DURATION = 10 * 60 * 1000; 

// 🛡️ ฟังก์ชันพระเอก! เปลี่ยนทุกอย่างให้เป็น Array ป้องกันการ Crash เวลา Supabase ส่ง Object มา
const toArray = (data: any) => {
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const teamFilter = searchParams.get('team') || 'all'; 
    const personFilter = searchParams.get('person') || 'all'; 

    const cacheKey = `${filter}_${teamFilter}_${personFilter}`;
    const now = Date.now();
    if (aiCache[cacheKey] && now - aiCache[cacheKey].timestamp < CACHE_DURATION) {
      return NextResponse.json(aiCache[cacheKey].data);
    }

    let startDate = null;
    const dateRef = new Date();
    let timeLabel = "ทั้งหมด";

    if (filter === 'daily') {
      startDate = new Date(dateRef.setHours(0, 0, 0, 0)).toISOString();
      timeLabel = "วันนี้";
    } else if (filter === 'weekly') {
      const lastWeek = new Date(dateRef.setDate(dateRef.getDate() - 7));
      startDate = lastWeek.toISOString();
      timeLabel = "7 วันล่าสุด";
    } else if (filter === 'monthly') {
      const startOfMonth = new Date(dateRef.getFullYear(), dateRef.getMonth(), 1);
      startDate = startOfMonth.toISOString();
      timeLabel = "เดือนนี้";
    }

    let query = supabase
      .from('order_item_projects')
      .select(`
        area_sqm, is_important, project_name, created_at,
        order_items (interest_level, product_categories (name), orders (customer_name, teams (team_name), profiles (full_name)))
      `)
      .eq('is_deleted', false);

    if (startDate) query = query.gte('created_at', startDate);

    const { data: rawStats, error: dbError } = await query;
    if (dbError) throw new Error(`DB Error: ${dbError.message}`);
    if (!rawStats) throw new Error("ไม่พบข้อมูล");

    // 🌟 ดึงชื่อทีมและบุคคลโดยใช้ toArray() ครอบ ป้องกัน Error ชะงัดนัก!
    const availableTeams = [...new Set(
      rawStats.flatMap((s: any) => 
        toArray(s.order_items).flatMap((item: any) => 
          toArray(item.orders).map((o: any) => o?.teams?.team_name)
        )
      ).filter(Boolean)
    )];

    const availablePersons = [...new Set(
      rawStats.flatMap((s: any) => 
        toArray(s.order_items).flatMap((item: any) => 
          toArray(item.orders).map((o: any) => o?.profiles?.full_name)
        )
      ).filter(Boolean)
    )];

    // 🌟 กรองข้อมูลอย่างปลอดภัย
    let stats = rawStats;
    if (teamFilter !== 'all') {
      stats = stats.filter((s: any) => 
        toArray(s.order_items).some((item: any) => 
          toArray(item.orders).some((o: any) => o?.teams?.team_name === teamFilter)
        )
      );
    }
    if (personFilter !== 'all') {
      stats = stats.filter((s: any) => 
        toArray(s.order_items).some((item: any) => 
          toArray(item.orders).some((o: any) => o?.profiles?.full_name === personFilter)
        )
      );
    }

    const totalOrders = stats.length;
    const totalSqm = stats.reduce((acc: number, curr: any) => acc + (Number(curr.area_sqm) || 0), 0);
    const importantCount = stats.filter((s: any) => s.is_important).length;
    
    const teamSummary: any = {};
    const personSummary: any = {}; 

    // 🌟 สรุปผลอย่างปลอดภัย ไร้กังวลเรื่อง Array
    stats.forEach((s: any) => {
      toArray(s.order_items).forEach((item: any) => {
        toArray(item.orders).forEach((o: any) => {
          const teamName = o?.teams?.team_name || 'ไม่มีทีม';
          const personName = o?.profiles?.full_name || 'ไม่ระบุตัวตน';
          teamSummary[teamName] = (teamSummary[teamName] || 0) + 1;
          personSummary[personName] = (personSummary[personName] || 0) + 1;
        });
      });
    });

    let aiSummary = "";
    const contextForAi = `สถิติช่วง ${timeLabel}: ออเดอร์ ${totalOrders} รายการ, พื้นที่รวม ${totalSqm.toFixed(2)} ตร.ม., สรุปรายทีม: ${JSON.stringify(teamSummary)}, สรุปรายบุคคล: ${JSON.stringify(personSummary)}`;

    try {
      if (!AI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

      const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${AI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `คุณคือ AI ผู้ช่วยแอดมินก่อสร้าง จากข้อมูลสถิติช่วง ${timeLabel} นี้: ${contextForAi} ช่วยสรุปสถานการณ์สั้นๆ 3 บรรทัด (ภาษาไทย เป็นกันเอง) ว่าภาพรวมเป็นยังไง ใครหรือทีมไหนเด่น และมีจุดไหนต้องระวังไหม` }] }]
        })
      });

      const aiData = await aiResponse.json();
      if (aiResponse.status === 429) {
        aiSummary = "ขณะนี้ AI มีผู้ใช้งานจำนวนมาก แอดมินดูตัวเลขสถิติด้านล่างไปก่อนได้ครับ";
      } else if (aiData.candidates && aiData.candidates.length > 0) {
        aiSummary = aiData.candidates[0].content.parts[0].text;
      } else {
        aiSummary = "AI วิเคราะห์แล้วแต่ยังไม่มีข้อสรุปในช่วงเวลานี้ครับ";
      }
    } catch (e) {
      aiSummary = "ไม่สามารถเชื่อมต่อ AI ได้ในขณะนี้";
    }

    const finalResponse = {
      summary_date: new Date().toLocaleDateString('th-TH'),
      time_filter: filter,
      time_label: timeLabel,
      ai_insight: aiSummary,
      available_teams: availableTeams,
      available_persons: availablePersons,
      stats: { 
        total_orders: totalOrders, 
        total_area_sqm: totalSqm.toFixed(2), 
        important_count: importantCount, 
        team_performance: teamSummary,
        person_performance: personSummary
      }
    };

    if (!aiSummary.includes("Quota Limit")) {
      aiCache[cacheKey] = { data: finalResponse, timestamp: now };
    }
    return NextResponse.json(finalResponse);

  } catch (error: any) {
    // 🚨 ถ้ารันแล้วยังพัง มันจะปริ้นบอกใน Terminal ชัดเจนเลยครับ!
    console.error("💥 [API ERROR]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { message, stats, history } = body;

    if (!AI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

    const systemContext = `คุณคือ AI ช่วยวิเคราะห์ข้อมูลก่อสร้าง ข้อมูลปัจจุบันคือ: ออเดอร์ทั้งหมด ${stats?.total_orders || 0}, พื้นที่รวม ${stats?.total_area_sqm || 0} ตร.ม., งานสำคัญ ${stats?.important_count || 0} งาน, สรุปรายทีม: ${JSON.stringify(stats?.team_performance || {})}. กรุณาตอบคำถามแอดมินสั้นๆ กระชับ`;

    const formattedHistory = history.map((msg: any) => ({
      role: msg.role === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));

    formattedHistory.push({
      role: 'user',
      parts: [{ text: `[บริบท: ${systemContext}]\n\nคำถาม: ${message}` }]
    });

    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${AI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: formattedHistory })
    });

    const aiData = await aiResponse.json();
    if (!aiResponse.ok) throw new Error(aiData.error?.message || "AI Chat API Error");

    let reply = "ขออภัยครับ ไม่สามารถประมวลผลคำตอบได้";
    if (aiData.candidates && aiData.candidates.length > 0) {
      reply = aiData.candidates[0].content.parts[0].text;
    }
    return NextResponse.json({ reply: reply });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}