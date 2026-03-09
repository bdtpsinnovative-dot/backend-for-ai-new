// app/api/v1/companies/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 🔍 GET: ดึงรายชื่อบริษัท พร้อมคืนค่าประเภทลูกค้ากลับไปด้วยเพื่อทำ Auto-fill
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const typeId = searchParams.get('type_id');
  const q = searchParams.get('q'); // 🌟 รองรับการค้นหาจากช่อง Search ของ Flutter

  try {
    // 🔥 แก้ไขจุดสำคัญ: เพิ่ม 'customer_type_id' เข้าไปใน select
    let query = supabase.from('companies').select('id, name, customer_type_id');

    // 🔍 ถ้านายส่ง q มา (ตอนที่ User พิมพ์ค้นหา) ให้ใช้ ilike กรองชื่อบริษัท
    if (q) {
      query = query.ilike('name', `%${q}%`);
    }

    // 🛠️ ถ้ามี type_id ส่งมา (กรณีเลือกประเภทก่อน) ให้กรองตามประเภท
    if (typeId && typeId !== 'null' && typeId !== 'undefined') {
      query = query.eq('customer_type_id', typeId);
    }

    const { data, error } = await query.order('name', { ascending: true }).limit(50);

    if (error) throw error;

    return NextResponse.json(data);
  } catch (err: any) {
    console.error("API Companies Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}