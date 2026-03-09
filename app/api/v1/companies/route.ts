import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  try {
    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);
    const body = await request.json();
    let { name, customer_type_id } = body;

    if (!name) return NextResponse.json({ error: 'กรุณาระบุชื่อบริษัท' }, { status: 400 });

    // 🌟 แปลงค่าว่างให้เป็น null เพื่อให้ Database ยอมรับ
    if (customer_type_id === '' || customer_type_id === 'null') customer_type_id = null;

    const { data: existingCompany } = await supabase
      .from('companies')
      .select('*')
      .eq('name', name)
      .eq(customer_type_id ? 'customer_type_id' : 'name', customer_type_id || name) 
      .maybeSingle();

    if (existingCompany) return NextResponse.json(existingCompany);

    const { data, error } = await supabase.from('companies')
      .insert({ name: name, customer_type_id: customer_type_id })
      .select().single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const typeId = searchParams.get('type_id');
  const q = searchParams.get('q'); 
  try {
    const supabase = createClient(supabaseUrl!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    let query = supabase.from('companies').select('id, name, customer_type_id');
    if (q) query = query.ilike('name', `%${q}%`);
    if (typeId && typeId !== 'null' && typeId !== 'undefined') query = query.eq('customer_type_id', typeId);
    
    const { data, error } = await query.order('name', { ascending: true }).limit(50);
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}