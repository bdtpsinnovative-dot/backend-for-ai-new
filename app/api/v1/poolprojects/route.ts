import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 🌟 ใช้ SERVICE_ROLE_KEY เพื่อให้คุมสิทธิ์การมองเห็นและแก้ไขได้อิสระในโค้ด
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ==========================================================
// 📥 1. GET Method (ดึงข้อมูลทั้งหมดให้ทุกคนเห็น)
// ==========================================================
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'กรุณาล็อกอินก่อนเข้าใช้งาน' }, { status: 401 });
    }

    // ตรวจสอบว่าเป็น Token ของจริง
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return NextResponse.json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50'); 
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // ดึงออเดอร์ของ "ทุกคน" มาโชว์
    const { data, error } = await supabase
      .from('order_items')
      .select(`
        *,
        product_categories(name),
        order_item_projects!inner(  
          id, area_sqm, project_name,          
          account_developer, contact_developer,
          account_architecture, contact_architecture,
          account_interior, contact_interior,
          account_contractor, contact_contractor,
          is_deleted
        ),
        orders(
          id, created_at, customer_name, phone,              
          is_synced, audit_log,  
          profiles(full_name, teams(team_name)),
          companies(name)
        )
      `)
      .eq('order_item_projects.is_deleted', false) 
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;
    return NextResponse.json(data);

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ==========================================================
// 📝 2. PATCH Method (แก้ไขข้อมูล - ดักไว้ให้แก้ได้แค่ของตัวเอง!)
// ==========================================================
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { 
      token, 
      order_id, 
      order_item_project_id, 
      customer_name, 
      phone,            
      project_name,      
      account_developer, contact_developer,
      account_architecture, contact_architecture,
      account_interior, contact_interior,
      account_contractor, contact_contractor
    } = body;

    if (!order_id || !order_item_project_id || !token) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบถ้วน (ต้องมี ID และ Token)' }, { status: 400 });
    }

    // 🛡️ ยืนยันตัวตนคนกดแก้ไข
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return NextResponse.json({ error: 'ยืนยันตัวตนไม่สำเร็จ' }, { status: 401 });
    }

    // 🛡️ เช็ค "ความเป็นเจ้าของ" (ตรวจสอบสิทธิ์)
    const { data: orderOwner } = await supabase
      .from('orders')
      .select('user_id')
      .eq('id', order_id)
      .single();

    // ถ้าไอดีคนสร้างบิล ไม่ตรงกับไอดีคนที่กำลังกดเซฟ ดีดออก!
    if (orderOwner?.user_id !== user.id) {
      return NextResponse.json({ error: 'คุณไม่มีสิทธิ์แก้ไขออเดอร์ของคนอื่นครับ!' }, { status: 403 });
    }

    // ผ่านด่านแล้ว ให้บันทึกข้อมูลได้ตามปกติ
    const { error: orderError } = await supabase
      .from('orders')
      .update({ customer_name, phone, is_synced: false })
      .eq('id', order_id);
    if (orderError) throw orderError;

    const { error: relationError } = await supabase
      .from('order_item_projects')
      .update({
        project_name, account_developer, contact_developer,
        account_architecture, contact_architecture,
        account_interior, contact_interior,
        account_contractor, contact_contractor
      })
      .eq('id', order_item_project_id);
    if (relationError) throw relationError;

    return NextResponse.json({ message: 'อัปเดตข้อมูลสำเร็จ' });

  } catch (error: any) {
    console.error('Update Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}