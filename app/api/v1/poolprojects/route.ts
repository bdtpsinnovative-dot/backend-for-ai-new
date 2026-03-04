import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ==========================================================
// 1. GET Method (ฉบับแก้ไขเพื่อให้กรองข้อมูลที่ลบแล้วออกถาวร)
// ==========================================================
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50'); 
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error } = await supabase
      .from('order_items')
      .select(`
        *,
        product_categories(name),
        order_item_projects!inner(  
          id, 
          area_sqm,
          project_name,          
          account_developer,
          contact_developer,
          account_architecture,
          contact_architecture,
          account_interior,
          contact_interior,
          account_contractor,
          contact_contractor,
          is_deleted
        ),
        orders(
          id,
          created_at,
          customer_name,
          phone,              
          is_synced,
          audit_log,  
          profiles(full_name, teams(team_name)),
          companies(name)
        )
      `)
      // 🌟 เงื่อนไขนี้จะทำงานร่วมกับ !inner เพื่อตัดรายการ order_items ทิ้งไปเลยถ้าโครงการโดนลบ
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
// 2. PATCH Method (อัปเดตข้อมูลแบบใหม่ ไม่ต้องไปยุ่งกับตาราง projects แล้ว)
// ==========================================================
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { 
      order_id, 
      order_item_project_id, 
      customer_name, 
      phone,             // 👈 เผื่อให้แก้เบอร์โทร/Line ได้ด้วย
      project_name,      // 👈 เซฟชื่อโปรเจกต์ลงตารางหลานโดยตรง
      account_developer,
      contact_developer,
      account_architecture,
      contact_architecture,
      account_interior,
      contact_interior,
      account_contractor,
      contact_contractor
    } = body;

    // เช็คแค่ 2 ID ก็พอครับ เพราะเราไม่ได้เชื่อมกับตาราง projects หลักแล้ว
    if (!order_id || !order_item_project_id) {
      return NextResponse.json({ error: 'Missing required IDs' }, { status: 400 });
    }

    // 1. อัปเดตข้อมูลลูกค้าที่ตารางแม่ (orders) และเปลี่ยนสถานะให้ Apps Script ดึงใหม่
    const { error: orderError } = await supabase
      .from('orders')
      .update({ 
        customer_name,
        phone,
        is_synced: false 
      })
      .eq('id', order_id);
    if (orderError) throw orderError;

    // 2. อัปเดตข้อมูลรายละเอียดที่ตารางหลาน (order_item_projects)
    const { error: relationError } = await supabase
      .from('order_item_projects')
      .update({
        project_name, // 👈 อัปเดตชื่อโปรเจกต์ตรงนี้เลย
        account_developer,
        contact_developer,
        account_architecture,
        contact_architecture,
        account_interior,
        contact_interior,
        account_contractor,
        contact_contractor
      })
      .eq('id', order_item_project_id);
    if (relationError) throw relationError;

    return NextResponse.json({ message: 'อัปเดตข้อมูลสำเร็จ' });

  } catch (error: any) {
    console.error('Update Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}