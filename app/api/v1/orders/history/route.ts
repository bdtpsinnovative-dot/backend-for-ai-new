import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// ใช้ Service Role Key หรือ Anon Key ตามเดิมของพอร์
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    // ✅ 1. รับค่า Page และ Limit (ถ้าไม่มี ให้ใช้ค่า Default)
    // Page: หน้าปัจจุบัน (เริ่มที่ 1)
    // Limit: จำนวนรายการต่อหน้า (เริ่มที่ 20)
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    // ✅ 2. คำนวณช่วงข้อมูล (Supabase ใช้ index เริ่มที่ 0)
    // ตัวอย่าง: หน้า 1 (0-19), หน้า 2 (20-39)
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const { data, error } = await supabase
  .from('orders')
  .select(`
    id, 
    created_at, 
    customer_name,
    phone,
    note,
    customer_types(name),
    companies(name),
    order_items (
      id, 
      note, 
      interest_level,
      images,
      product_categories(name),
      order_item_projects (
        area_sqm,
        projects (
          project_name
        )
      )
    )
  `)
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .range(from, to);
    if (error) throw error;

    return NextResponse.json(data);

  } catch (error: any) {
  console.error('Full Error Details:', error); // ดูใน Terminal ของคุณว่ามันฟ้องเรื่อง Timeout หรือ RLS หรือไม่
  return NextResponse.json({ error: error.message }, { status: 500 });
}
}