//app/api/v1/upload-avatar/route.ts

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import sharp from 'sharp'; // ✅ ใช้สำหรับบีบอัดรูปภาพ
export const dynamic = 'force-dynamic'; // 🌟 บังคับให้เป็น Dynamic ตลอดเวลา
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'ไม่พบไฟล์ที่อัปโหลด' }, { status: 400 });
    }

    // 1. อ่านค่า Config
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Server Config Error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 2. แปลงไฟล์เป็น Buffer เพื่อให้ Sharp ประมวลผลได้
    const buffer = Buffer.from(await file.arrayBuffer());

    // 🔥 3. ขั้นตอน Pro: บีบอัดและแปลงเป็น WebP
    // - ย่อขนาดให้กว้าง 500px (พอดีสำหรับรูปโปรไฟล์)
    // - แปลงเป็น .webp
    // - ตั้งค่า Quality 80% (ชัดแต่ไฟล์เล็กมาก)
    const webpBuffer = await sharp(buffer)
      .resize(500, 500, { fit: 'cover' }) 
      .webp({ quality: 80 })
      .toBuffer();

    // 4. ตั้งชื่อไฟล์ใหม่เป็น .webp เท่านั้น
    const fileName = `avatar-${Date.now()}.webp`;
    
    // ✅ 5. ใช้ Bucket ชื่อ 'profiles' ตามที่พี่สร้างไว้
    const BUCKET_NAME = 'profiles'; 

    // 6. อัปโหลดไฟล์ขึ้น Supabase
    const { data, error } = await supabase
      .storage
      .from(BUCKET_NAME)
      .upload(fileName, webpBuffer, {
        contentType: 'image/webp', // ระบุประเภทไฟล์ให้ชัดเจน
        upsert: true
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 7. ขอ Public URL
    const { data: { publicUrl } } = supabase
      .storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    return NextResponse.json({ publicUrl });

  } catch (error: any) {
    console.error("🔥 WebP Upload Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}