 import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// API สำหรับสร้างโครงการใหม่
export async function POST(request: Request) {
  try {
    const { project_name } = await request.json();

    if (!project_name) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('projects')
      .insert({ project_name })
      .select('id, project_name')
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}