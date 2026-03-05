import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(req: Request) {
  try {
    const apiKey = req.headers.get('x-api-key');
    const secretKey = (process.env.SHEETS_SECRET_KEY || '').trim();

    if (apiKey !== secretKey) {
      return NextResponse.json({ error: 'Invalid API key from Route' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const table = searchParams.get('table');

    // 🌟 โหมดที่ 1: ถ้ามีชื่อตารางส่งมา = โหมด Backup (ดึงทุกอย่างในตารางนั้น)
    if (table) {
      const { data, error } = await supabase.from(table).select('*');
      if (error) throw error;
      return NextResponse.json(data);
    } 
    // 🌟 โหมดที่ 2: ถ้าไม่มีชื่อตาราง = โหมดดึงออเดอร์ปกติ (เหมือนที่พี่ใช้ประจำ)
    else {
      const { data, error } = await supabase
        .from('orders')
        .select('id,customer_name,phone,created_at,teams(*),profiles(*),order_items(interest_level,note,images,product_categories(name),order_item_projects(id,project_name,area_sqm,account_developer,contact_developer,account_architecture,contact_architecture,account_interior,contact_interior,account_contractor,contact_contractor))')
        .eq('is_synced', false);

      if (error) throw error;
      return NextResponse.json(data);
    }
  } catch (error: any) {
    console.error('API Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get('x-api-key');
    if (apiKey !== (process.env.SHEETS_SECRET_KEY || '').trim()) {
      return NextResponse.json({ error: 'Unauthorized: Invalid API Key' }, { status: 401 });
    }

    const body = await req.json();
    const { action, payload } = body;

    if (action === 'mark_synced') {
      const { orderIds } = payload;
      const { error } = await supabase.from('orders').update({ is_synced: true }).in('id', orderIds);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Orders marked as synced' });
    } 
    
    else if (action === 'update_project') {
      const { id, updates } = payload;
      const { error } = await supabase.from('order_item_projects').update(updates).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Project updated successfully' });
    }
    
    // 🚑 โหมดกู้ชีพ: อัปโหลดข้อมูลจาก JSON กลับเข้าตาราง
    else if (action === 'restore_data') {
      const { table, data } = payload;
      // ใช้ upsert เพื่อสร้างใหม่หรืออัปเดตทับข้อมูลเดิม
      const { error } = await supabase.from(table).upsert(data);
      if (error) throw error;
      return NextResponse.json({ success: true, message: `Restored ${table} successfully` });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error: any) {
    console.error('Webhook Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}