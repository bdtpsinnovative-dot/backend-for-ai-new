import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ==========================================
// 📥 1. GET: สำหรับดึงข้อมูล (Sync & Backup)
// ==========================================
export async function GET(req: Request) {
  try {
    const apiKey = req.headers.get('x-api-key');
    const secretKey = (process.env.SHEETS_SECRET_KEY || '').trim();

    if (apiKey !== secretKey) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const table = searchParams.get('table');

    // 🌟 โหมด Backup: ดึงข้อมูลยกตาราง
    if (table) {
      const { data, error } = await supabase.from(table).select('*');
      if (error) throw error;
      return NextResponse.json(data);
    } 
    
    // 🌟 โหมด Sync ปกติ: ดึงออเดอร์ที่ยังไม่ได้ซิงค์
    else {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, customer_name, phone, created_at,
          teams(*),
          profiles(*),
          order_items(
            id, interest_level, note, images,
            product_categories(name),
            order_item_projects(
              id, project_name, area_sqm, 
              account_developer, contact_developer, 
              account_architecture, contact_architecture, 
              account_interior, contact_interior, 
              account_contractor, contact_contractor
            )
          )
        `)
        .eq('is_synced', false);

      if (error) throw error;
      return NextResponse.json(data);
    }
  } catch (error: any) {
    console.error('API Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ==========================================
// 🚀 2. POST: สำหรับแก้ไขข้อมูล (Update, Mark Synced, Restore)
// ==========================================
export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get('x-api-key');
    if (apiKey !== (process.env.SHEETS_SECRET_KEY || '').trim()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, payload } = body;

    // ✅ Action: ยืนยันการซิงค์ออเดอร์
    if (action === 'mark_synced') {
      const { orderIds } = payload;
      const { error } = await supabase.from('orders').update({ is_synced: true }).in('id', orderIds);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Orders marked as synced' });
    } 
    
    // ✅ Action: แก้ไขข้อมูลจาก Google Sheets (รองรับการแก้ข้ามตาราง)
    else if (action === 'update_project') {
      const { id, updates } = payload; // id คือ ID ของ order_item_projects (คอลัมน์ T)

      // 1. แยก Field ระหว่างตาราง Items (I, J) และ Projects (H, K, L-S)
      const itemFields = ['note', 'interest_level'];
      const itemUpdates: any = {};
      const projectUpdates: any = {};

      Object.keys(updates).forEach(key => {
        if (itemFields.includes(key)) {
          itemUpdates[key] = updates[key];
        } else {
          projectUpdates[key] = updates[key];
        }
      });

      // 2. อัปเดตตาราง order_item_projects (ข้อมูลโปรเจกต์)
      if (Object.keys(projectUpdates).length > 0) {
        const { error: projErr } = await supabase
          .from('order_item_projects')
          .update(projectUpdates)
          .eq('id', id);
        if (projErr) throw projErr;
      }

      // 3. อัปเดตตาราง order_items (Note และความสนใจ)
      if (Object.keys(itemUpdates).length > 0) {
        // หา order_item_id จากตาราง project ก่อนเพื่อไปอัปเดตตารางแม่
        const { data: proj, error: findErr } = await supabase
          .from('order_item_projects')
          .select('order_item_id')
          .eq('id', id)
          .single();

        if (findErr) throw findErr;

        if (proj?.order_item_id) {
          const { error: itemErr } = await supabase
            .from('order_items')
            .update(itemUpdates)
            .eq('id', proj.order_item_id);
          if (itemErr) throw itemErr;
        }
      }

      return NextResponse.json({ success: true, message: 'Updated successfully' });
    }
    
    // ✅ Action: กู้คืนข้อมูล (Restore)
    else if (action === 'restore_data') {
      const { table, data } = payload;
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