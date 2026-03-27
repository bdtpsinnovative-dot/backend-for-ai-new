import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// --------------------------------------------------------
// 1. ฟังก์ชัน POST (ดึงข้อมูลโปรไฟล์)
// --------------------------------------------------------
export async function POST(request: Request) {
  try {
    const { token } = await request.json();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // ใช้ Service Role เพื่อ bypass RLS ในบางกรณี

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ✅ 1. ตรวจสอบ Token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid or Expired Token' }, { status: 401 });
    }

    // ✅ 2. ดึงโปรไฟล์ (รวมคอลัมน์ noti_level และ is_muted ที่เราเพิ่มใหม่)
    const { data: profile, error } = await supabase
      .from('profiles')
      .select(`
        *,
        teams (
          team_name,
          description
        )
      `)
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
       console.error("💥 Database Error:", error.message);
       return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!profile) {
      return NextResponse.json({ 
        profile: { 
          email: user.email, 
          full_name: 'รอกำหนดชื่อ',
          noti_level: 'team', // ค่า Default ถ้าหาไม่เจอ
          is_muted: false 
        },
        message: 'Profile record not found' 
      });
    }

    return NextResponse.json({ profile });

  } catch (err: any) {
    console.error("💥 Server Error:", err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// --------------------------------------------------------
// 2. ฟังก์ชัน PUT (บันทึกการเปลี่ยนแปลงข้อมูล)
// --------------------------------------------------------
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { token, full_name, phone_number, avatar_url, noti_level, is_muted } = body;

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ตรวจสอบ Token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Invalid Token' }, { status: 401 });

    // ✅ เตรียมข้อมูลอัปเดต
    const updateData: any = { 
      full_name, 
      phone_number, 
      updated_at: new Date().toISOString() 
    };

    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;
    
    // ✅ บังคับแปลง Type ให้ชัวร์ 100% ว่าตรงกับ Database
    if (noti_level !== undefined) {
      updateData.noti_level = String(noti_level); 
    }
    if (is_muted !== undefined) {
      // แปลงเป็น Boolean ให้แน่ใจ
      updateData.is_muted = is_muted === true || is_muted === 'true' || is_muted === 1; 
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', user.id);

    if (updateError) {
      console.error("💥 Update Error:", updateError.message);
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ message: 'Success' });

  } catch (err: any) {
    console.error("💥 Server Error:", err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}