// app/api/v1/notifications/[id]/read/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // 1. ดึง ID ของแจ้งเตือนจาก URL
    const notificationId = params.id;

    // 2. อัปเดตสถานะ is_read ให้เป็น true ใน Database
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Marked as read' });

  } catch (err: any) {
    console.error("PUT Read Notification Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}