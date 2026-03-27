// app/api/v1/profiles/fcm/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function PATCH(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 1. ตรวจสอบ User จาก Token
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });

    // 2. รับ fcm_token จาก Body
    const { fcm_token } = await req.json();

    // 3. อัปเดตลงตาราง profiles
    const { error } = await supabase
      .from('profiles')
      .update({ fcm_token: fcm_token })
      .eq('id', user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}