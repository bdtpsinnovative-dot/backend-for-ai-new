//app/api/v1/poolprojects/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
    const scope = searchParams.get('scope') || 'all'; 
    const from = (page - 1) * limit;
    const to = from + limit - 1;

   const { data: profileData } = await supabase
    .from('profiles')
    .select('team_id')
    .eq('id', user.id)
    .single();

  // 🌟 พิมพ์บรรทัดนี้ลงไปเพื่อพิสูจน์
  console.log("==== รันไฟล์นี้อยู่จริงๆ คอนเฟิร์ม! ====");

  let query = supabase
    .from('order_items')
      .select(`
        *,
        product_categories(name),
        order_item_projects!inner(
          id, 
          area_sqm, 
          project_name,
          is_important,
          project_type_id,
          project_types(name),
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
        orders!inner(
          id, 
          created_at, 
          customer_name, 
          phone,
          is_synced, 
          audit_log, 
          user_id, 
          team_id,
          profiles(full_name, teams(team_name)),
          companies(name)
        )
      `, { count: 'exact' }) 
      .eq('order_item_projects.is_deleted', false) 
      .order('created_at', { ascending: false });

    if (scope === 'mine') {
      query = query.eq('orders.user_id', user.id); 
    } else if (scope === 'team' && profileData?.team_id) {
      query = query.eq('orders.team_id', profileData.team_id); 
    }

    const { data, count, error } = await query.range(from, to);

    if (error) throw error;
    
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
      project_type_id,
      is_important,
      account_developer, contact_developer,
      account_architecture, contact_architecture,
      account_interior, contact_interior,
      account_contractor, contact_contractor,
      note
    } = body;

    if (!token) {
      return NextResponse.json({ error: 'กรุณาล็อกอินก่อนใช้งาน (ไม่พบ Token)' }, { status: 401 });
    }
    if (!order_id) {
      return NextResponse.json({ error: 'ต้องมีรหัส Order ID' }, { status: 400 });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' }, { status: 401 });
    }

    const { data: orderOwner } = await supabase.from('orders').select('user_id').eq('id', order_id).single();
    if (orderOwner?.user_id !== user.id) {
      return NextResponse.json({ error: 'ไม่สามารถดำเนินการได้ เนื่องจากคุณไม่ใช่เจ้าของรายการครับ' }, { status: 403 });
    }

    if (customer_name !== undefined || phone !== undefined) {
      const { error: orderError } = await supabase
        .from('orders')
        .update({ customer_name, phone, is_synced: false })
        .eq('id', order_id);
      if (orderError) throw orderError;
    }
    if (note !== undefined) {
      // อัปเดต note ให้กับทุก order_items ที่อยู่ใน order_id นี้
      const { error: noteError } = await supabase
        .from('order_items')
        .update({ note: note })
        .eq('order_id', order_id); 
      if (noteError) throw noteError;
    }

    if (order_item_project_id) {
      const updateData: any = {};
      if (project_name !== undefined) updateData.project_name = project_name;
      if (area_sqm !== undefined) updateData.area_sqm = area_sqm;
      if (project_type_id !== undefined) updateData.project_type_id = project_type_id;
      if (is_important !== undefined) updateData.is_important = is_important;
      if (account_developer !== undefined) updateData.account_developer = account_developer;
      if (contact_developer !== undefined) updateData.contact_developer = contact_developer;
      if (account_architecture !== undefined) updateData.account_architecture = account_architecture;
      if (contact_architecture !== undefined) updateData.contact_architecture = contact_architecture;
      if (account_interior !== undefined) updateData.account_interior = account_interior;
      if (contact_interior !== undefined) updateData.contact_interior = contact_interior;
      if (account_contractor !== undefined) updateData.account_contractor = account_contractor;
      if (contact_contractor !== undefined) updateData.contact_contractor = contact_contractor;

      const { data: projectData, error: relationError } = await supabase
        .from('order_item_projects')
        .update(updateData)
        .eq('id', order_item_project_id)
        .select('order_item_id')
        .single();
        
      if (relationError) throw relationError;

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