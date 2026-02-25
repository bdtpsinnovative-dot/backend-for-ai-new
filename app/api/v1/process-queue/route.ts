import { Redis } from '@upstash/redis'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// เชื่อมต่อ Redis และ Supabase
const redis = Redis.fromEnv()
const supabase = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

export async function GET() {
  let count = 0
  
  while (true) {
    // 1. ดึงข้อมูลจากคิว (Redis) ออกมาทีละ 1 ออเดอร์
    const body: any = await redis.rpop('order_queue')
    if (!body) break // ถ้าคิวว่างแล้วให้หยุดทำงาน

    try {
      // 2. แกะกล่องข้อมูลที่มาจาก Redis
      const { customer_type_id, company_id, customer_name, phone, items } = body;
      const user = { id: body.user_id || '38bfe943-d3fd-4e40-ac88-7e39dff9b903' };

      // 🔥 ไปหา team_id ของ User
      const { data: profile } = await supabase
        .from('profiles')
        .select('team_id')
        .eq('id', user.id)
        .single();

      const team_id = profile?.team_id;

      // 📝 บันทึกลงตาราง orders
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          user_id: user.id,
          team_id: team_id,
          customer_type_id,
          company_id,
          customer_name,
          phone,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // 📦 วนลูปบันทึก "รายการสินค้า" (Items)
      if (items && items.length > 0) {
        for (const item of items) {
          
          // 📸 อัปโหลดรูปภาพ
          let itemImageUrls: string[] = [];
          
          if (item.images && Array.isArray(item.images) && item.images.length > 0) {
            for (let i = 0; i < item.images.length; i++) {
              const base64Data = item.images[i];
              
              const fileName = `order_${order.id}_${Date.now()}_${i}.webp`;
              const buffer = Buffer.from(base64Data, 'base64');

              const { data: uploadData, error: uploadError } = await supabase.storage
                .from('orders') 
                .upload(fileName, buffer, { 
                  contentType: 'image/webp',
                  upsert: true 
                });

              if (uploadError) {
                console.error("Upload Error:", uploadError);
                continue; 
              }

              if (uploadData) {
                const { data: publicUrl } = supabase.storage
                  .from('orders')
                  .getPublicUrl(fileName);
                
                itemImageUrls.push(publicUrl.publicUrl);
              }
            }
          }

          // 📝 บันทึกสินค้าลง order_items
          const { data: savedItem, error: itemError } = await supabase
            .from('order_items')
            .insert({
              order_id: order.id,
              product_category_id: item.product_category_id,
              interest_level: item.interest_level, 
              note: item.note,
              images: itemImageUrls 
            })
            .select()
            .single();

          if (itemError) throw itemError;

          // 🏗️ บันทึกการใช้โครงการ + พื้นที่ (order_item_projects)
          if (item.project_usage && item.project_usage.length > 0) {
            const projectUsagePayload = item.project_usage.map((usage: any) => ({
              order_item_id: savedItem.id,
              project_id: usage.project_id,
              area_sqm: usage.area_sqm ? parseFloat(usage.area_sqm) : 0
            }));

            const { error: usageError } = await supabase
              .from('order_item_projects')
              .insert(projectUsagePayload);

            if (usageError) throw usageError;
          }
        }
      }
      
      // นับว่าบันทึกสำเร็จไปกี่ออเดอร์
      count++
    } catch (err) {
      console.error("Worker Error สำหรับออเดอร์นี้:", err)
      // ไม่ใช้ throw เพื่อให้ระบบไปดึงออเดอร์ถัดไปมาทำต่อได้แม้มี error
    }
  }

  // ตอบกลับเมื่อเคลียร์คิวจนหมด
  return NextResponse.json({ success: true, processed: count, message: "ย้ายข้อมูลลง Database เสร็จสิ้น" })
}