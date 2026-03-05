// app/api/categories/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
  try {
    // 🌟 ดึงข้อมูลจากตาราง product_categories
    const { data, error } = await supabase
      .from('product_categories')
      .select('id, name')
      .order('name', { ascending: true }); // เรียงตามชื่อ หรือจะเรียงตาม created_at ก็ได้

    if (error) throw error;

    return NextResponse.json({ data });

  } catch (error: any) {
    console.error('API Error Fetching Categories:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}