// app/api/v1/notifications/read/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
  try {
    // 🌟 รับค่า ID มาตรงๆ จาก Body ปลอดภัยสุดครับ
    const { notification_id } = await request.json();

    if (!notification_id) {
      return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    }

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notification_id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Marked as read' });

  } catch (err: any) {
    console.error("POST Read Notification Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}