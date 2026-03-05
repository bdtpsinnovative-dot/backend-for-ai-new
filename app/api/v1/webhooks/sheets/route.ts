//app/api/v1/webhooks/sheets/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 🌟 ตัดช่องว่างอัตโนมัติ ป้องกัน "Invalid header value"
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

    const { data, error } = await supabase
      .from('orders')
      .select('id,customer_name,phone,created_at,teams(*),profiles(*),order_items(interest_level,note,images,product_categories(name),order_item_projects(id,project_name,area_sqm,account_developer,contact_developer,account_architecture,contact_architecture,account_interior,contact_interior,account_contractor,contact_contractor))')
      .eq('is_synced', false);

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
export async function POST(req: Request) {
  try {
    // 1. ตรวจสอบรหัสลับ (Security Check)
    const apiKey = req.headers.get('x-api-key');
    if (apiKey !== process.env.SHEETS_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized: Invalid API Key' }, { status: 401 });
    }

    const body = await req.json();
    const { action, payload } = body;

    // 2. แยกการทำงานตาม Action ที่ Google Sheet ส่งมา
    if (action === 'mark_synced') {
      // อัปเดตตาราง orders ให้ is_synced = true
      const { orderIds } = payload;
      const { error } = await supabase
        .from('orders')
        .update({ is_synced: true })
        .in('id', orderIds);

      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Orders marked as synced' });
    } 
    
    else if (action === 'update_project') {
      // แก้ไขหรือลบข้อมูลในตาราง order_item_projects
      const { id, updates } = payload;
      const { error } = await supabase
        .from('order_item_projects')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Project updated successfully' });
    }

    // ถ้าส่ง Action มาผิด
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error: any) {
    console.error('Webhook Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}