import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { token } = await request.json();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseAnonKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // สร้าง Client
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // ✅ 1. ตรวจสอบก่อนว่า Token นี้คือใคร (Get User ID)
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid or Expired Token' }, { status: 401 });
    }

    // ✅ 2. ดึงโปรไฟล์โดยระบุ ID ของ User คนนั้นให้ชัดเจน
    const { data: profile, error } = await supabase
      .from('profiles')
      .select(`
        *,
        teams (
          team_name,
          description
        )
      `)
      .eq('id', user.id) // ดึงเฉพาะของตัวเองเท่านั้น
      .maybeSingle(); // ใช้ maybeSingle เพื่อไม่ให้ Error ถ้ายังไม่มีแถวข้อมูล

    if (error) {
       console.error("💥 Database Error:", error.message);
       return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // ถ้าไม่มีข้อมูลโปรไฟล์เลย (Row ไม่เคยถูกสร้าง)
    if (!profile) {
      return NextResponse.json({ 
        profile: { email: user.email, full_name: 'รอกำหนดชื่อ' },
        message: 'Profile record not found' 
      });
    }

    return NextResponse.json({ profile });

  } catch (err: any) {
    console.error("💥 Server Error:", err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// ... ส่วน PUT (อัปเดต) ให้ใช้หลักการเช็ค user.id จาก token เหมือนกันครับ ...

// --------------------------------------------------------
// 2. ฟังก์ชัน PUT (บันทึกข้อมูล + รูปภาพ)
// --------------------------------------------------------
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { token, full_name, phone_number, avatar_url } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Server Config Error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // เช็ก User
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Invalid Token' }, { status: 401 });

    // ✅ เตรียมข้อมูลอัปเดต
    const updateData: any = { 
      full_name, 
      phone_number, 
      updated_at: new Date().toISOString() 
    };

    // ✅ ถ้ามีรููปส่งมา ให้อัปเดตด้วย
    if (avatar_url) {
      updateData.avatar_url = avatar_url;
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', user.id);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });

    return NextResponse.json({ message: 'Success' });

  } catch (err: any) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}