// app/api/v1/notifications/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// 🌟 เพิ่ม 2 บรรทัดนี้! บังคับให้ Next.js ไปดึงข้อมูลสดๆ จากดาต้าเบสทุกครั้ง ห้ามจำ!
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
  try {
    // 1. ดึง Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');

    // 2. ตรวจสอบ User
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid Token' }, { status: 401 });
    }

    // 3. ดึงข้อมูล
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*, creator:profiles!notifications_creator_id_fkey(full_name, avatar_url)')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false }) 
      .limit(50); 

    if (error) throw error;

    return NextResponse.json(notifications || []);

  } catch (err: any) {
    console.error("GET Notifications Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } 
}