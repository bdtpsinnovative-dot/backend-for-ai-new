// app/api/v1/poolprojects/filters/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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

    // 1. ดึงประเภทสินค้าทั้งหมด
    const { data: categories } = await supabase
      .from('product_categories')
      .select('name')
      .order('name');

    // 2. ดึงประเภทโครงการทั้งหมด
    const { data: projectTypes } = await supabase
      .from('project_types')
      .select('name')
      .order('name');

    // 3. ดึงชื่อคนทั้งหมด (หรือเซลล์) ใน profiles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('full_name')
      .not('full_name', 'is', null)
      .order('full_name');

    // จัดรูปแบบข้อมูลส่งกลับไปให้ Flutter
    return NextResponse.json({
      categories: categories?.map(c => c.name) || [],
      projectTypes: projectTypes?.map(p => p.name) || [],
      saleNames: profiles?.map(p => p.full_name) || [],
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}