import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
  try {
    // 🌟 ดึงข้อมูลจากตาราง project_types ที่เราเพิ่งรัน SQL ไป
    const { data, error } = await supabase
      .from('project_types')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error: any) {
    console.error("API Error (v1/project-types):", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}