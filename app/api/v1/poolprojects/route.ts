import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ==========================================================
// 1. GET Method
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
        order_item_projects(
          id, 
          area_sqm,
          developer_name,
          designer_name,
          architect_name,
          interior_name,
          home_builder_name,
          turnkey_th_name,
          inhouse_designer_name,
          projects(id, project_name)
        ),
        orders(
          id,
          created_at,
          customer_name,
          note,
          is_synced,
          audit_log,  
          profiles(full_name, teams(team_name)),
          companies(name)
        )
      `)
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
// 2. PATCH Method - อัปเดตข้อมูลแยกตาราง (อันนี้เหมือนเดิมที่ผมแก้ให้)
// ==========================================================
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { 
      order_id, 
      project_id, 
      order_item_project_id, 
      customer_name, 
      project_name,
      developer_name,
      designer_name,
      architect_name,
      interior_name,
      home_builder_name,
      turnkey_th_name,
      inhouse_designer_name
    } = body;

    if (!order_id || !project_id || !order_item_project_id) {
      return NextResponse.json({ error: 'Missing required IDs' }, { status: 400 });
    }

    const { error: orderError } = await supabase
      .from('orders')
      .update({ 
        customer_name,
        is_synced: false 
      })
      .eq('id', order_id);
    if (orderError) throw orderError;

    const { error: projectError } = await supabase
      .from('projects')
      .update({ project_name })
      .eq('id', project_id);
    if (projectError) throw projectError;

    const { error: relationError } = await supabase
      .from('order_item_projects')
      .update({
        developer_name,
        designer_name,
        architect_name,
        interior_name,
        home_builder_name,
        turnkey_th_name,
        inhouse_designer_name
      })
      .eq('id', order_item_project_id);
    if (relationError) throw relationError;

    return NextResponse.json({ message: 'อัปเดตข้อมูลสำเร็จ' });

  } catch (error: any) {
    console.error('Update Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}