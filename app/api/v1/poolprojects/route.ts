import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 🌟 ใช้ SERVICE_ROLE_KEY เพื่อให้คุมสิทธิ์การมองเห็นและแก้ไขได้อิสระในโค้ด
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ==========================================================
// 📥 1. GET Method (เพิ่มระบบนับจำนวน และกรองสิทธิ์)
// ==========================================================
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'กรุณาล็อกอินก่อนเข้าใช้งาน' }, { status: 401 });
    }

    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return NextResponse.json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50'); 
    const scope = searchParams.get('scope') || 'all'; // 🌟 รับค่า scope: 'mine', 'team', 'all'
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // 🌟 ดึงข้อมูล Team ID ของ User คนนี้ก่อน (เพื่อเอาไปใช้กรองของทีม)
    const { data: profileData } = await supabase
      .from('profiles')
      .select('team_id')
      .eq('id', user.id)
      .single();

    // 🌟 สร้าง Query (เพิ่ม { count: 'exact' } เพื่อให้นับจำนวนทั้งหมดด้วย)
    let query = supabase
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
        orders!inner(
          id, created_at, customer_name, phone,              
          is_synced, audit_log, user_id, team_id,  
          profiles(full_name, teams(team_name)),
          companies(name)
        )
      `, { count: 'exact' }) // 👈 สั่งให้นับ
      .eq('order_item_projects.is_deleted', false) 
      .order('created_at', { ascending: false });

    // 🌟 กรองข้อมูลตาม Scope ที่ส่งมา
    if (scope === 'mine') {
      query = query.eq('orders.user_id', user.id); // ของฉันเท่านั้น
    } else if (scope === 'team' && profileData?.team_id) {
      query = query.eq('orders.team_id', profileData.team_id); // ของทีมฉันเท่านั้น
    }

    // สั่งแบ่งหน้า
    const { data, count, error } = await query.range(from, to);

    if (error) throw error;
    
    // 🌟 ส่งกลับทั้งข้อมูล และ จำนวนทั้งหมด (total)
    return NextResponse.json({ 
      data: data, 
      total: count,
      page: page,
      limit: limit
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
export async function PATCH(request: Request) {
  try {
    // 🌟 1. ดึง Token จาก Header (ใช้วิธีเดียวกับ GET)
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    const body = await request.json();
    const { 
      order_id, 
      order_item_project_id, 
      customer_name, 
      phone,            
      project_name,      
      area_sqm,            
      product_category_id, 
      account_developer, contact_developer,
      account_architecture, contact_architecture,
      account_interior, contact_interior,
      account_contractor, contact_contractor
    } = body;

    // 🌟 2. ดัก Error แบบแยกกันให้ชัดเจน จะได้รู้ว่าพังตรงไหน
    if (!token) {
      return NextResponse.json({ error: 'กรุณาล็อกอินก่อนใช้งาน (ไม่พบ Token)' }, { status: 401 });
    }
    if (!order_id) {
      return NextResponse.json({ error: 'ต้องมีรหัส Order ID' }, { status: 400 });
    }

    // ยืนยันตัวตน
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' }, { status: 401 });
    }

    // เช็คความเป็นเจ้าของ
    const { data: orderOwner } = await supabase.from('orders').select('user_id').eq('id', order_id).single();
    if (orderOwner?.user_id !== user.id) {
      return NextResponse.json({ error: 'ไม่สามารถดำเนินการได้ เนื่องจากคุณไม่ใช่เจ้าของรายการครับ' }, { status: 403 });
    }

    // 🌟 3. อัปเดตตาราง orders (ทำเสมอถ้ามีการส่งชื่อลูกค้าหรือเบอร์โทรมา)
    if (customer_name !== undefined || phone !== undefined) {
      const { error: orderError } = await supabase
        .from('orders')
        .update({ customer_name, phone, is_synced: false })
        .eq('id', order_id);
      if (orderError) throw orderError;
    }

    // 🌟 4. อัปเดตตารางย่อย (ทำเฉพาะตอนส่ง order_item_project_id มา)
    if (order_item_project_id) {
      const { data: projectData, error: relationError } = await supabase
        .from('order_item_projects')
        .update({
          project_name, 
          area_sqm, 
          account_developer, contact_developer,
          account_architecture, contact_architecture,
          account_interior, contact_interior,
          account_contractor, contact_contractor
        })
        .eq('id', order_item_project_id)
        .select('order_item_id')
        .single();
      if (relationError) throw relationError;

      // อัปเดต Category
      if (projectData?.order_item_id && product_category_id) {
         const { error: itemError } = await supabase
           .from('order_items')
           .update({ product_category_id }) 
           .eq('id', projectData.order_item_id);
         if (itemError) throw itemError;
      }
    }

    return NextResponse.json({ message: 'อัปเดตข้อมูลสำเร็จ' });

  } catch (error: any) {
    console.error('Update Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}