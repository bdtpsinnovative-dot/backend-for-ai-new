import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const AI_API_KEY = process.env.GEMINI_API_KEY;

let aiCache: { [key: string]: { data: any; timestamp: number } } = {};
const CACHE_DURATION = 10 * 60 * 1000; 

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const teamFilter = searchParams.get('team') || 'all'; // 🌟 รับค่าทีม
    const personFilter = searchParams.get('person') || 'all'; // 🌟 รับค่าบุคคล

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
    if (dbError || !rawStats) throw new Error("ดึงข้อมูลจาก Database ไม่สำเร็จ");

    // 🌟 ดึงชื่อทีมและบุคคลทั้งหมดส่งกลับไปให้แอปทำ Dropdown
    const availableTeams = [...new Set(rawStats.map(s => s.order_items?.orders?.teams?.team_name).filter(Boolean))];
    const availablePersons = [...new Set(rawStats.map(s => s.order_items?.orders?.profiles?.full_name).filter(Boolean))];

    // 🌟 กรองข้อมูลตามที่แอดมินเลือก
    let stats = rawStats;
    if (teamFilter !== 'all') {
      stats = stats.filter(s => s.order_items?.orders?.teams?.team_name === teamFilter);
    }
    if (personFilter !== 'all') {
      stats = stats.filter(s => s.order_items?.orders?.profiles?.full_name === personFilter);
    }

    const totalOrders = stats.length;
    const totalSqm = stats.reduce((acc, curr) => acc + (Number(curr.area_sqm) || 0), 0);
    const importantCount = stats.filter(s => s.is_important).length;
    
    const teamSummary: any = {};
    const personSummary: any = {}; // 🌟 สถิติรายบุคคล

    stats.forEach((s: any) => {
      const teamName = s.order_items?.orders?.teams?.team_name || 'ไม่มีทีม';
      const personName = s.order_items?.orders?.profiles?.full_name || 'ไม่ระบุตัวตน';
      teamSummary[teamName] = (teamSummary[teamName] || 0) + 1;
      personSummary[personName] = (personSummary[personName] || 0) + 1;
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
      available_teams: availableTeams,     // 🌟 ส่งลิสต์ทีม
      available_persons: availablePersons, // 🌟 ส่งลิสต์รายชื่อ
      stats: { 
        total_orders: totalOrders, 
        total_area_sqm: totalSqm.toFixed(2), 
        important_count: importantCount, 
        team_performance: teamSummary,
        person_performance: personSummary  // 🌟 ส่งอันดับบุคคล
      }
    };

    if (!aiSummary.includes("Quota Limit")) {
      aiCache[cacheKey] = { data: finalResponse, timestamp: now };
    }
    return NextResponse.json(finalResponse);

  } catch (error: any) {
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