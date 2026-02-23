import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// 🛡️ สร้าง Supabase Client ด้วย ANON_KEY เพื่อความปลอดภัยตามมาตรฐาน
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 🔍 GET: ดึงข้อมูล Master Data สำหรับ Dropdown ในแอป
export async function GET() {
  try {
    const [customerTypes, productCategories, projects] = await Promise.all([
      supabase.from('customer_types').select('*').order('created_at'),
      supabase.from('product_categories').select('*').order('created_at'),
      supabase.from('projects').select('*').order('created_at'),
    ]);

    return NextResponse.json({
      customer_types: customerTypes.data || [],
      product_categories: productCategories.data || [],
      projects: projects.data || []
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// 💾 POST: บันทึกข้อมูล Order พร้อมตรวจสอบตัวตนและบันทึก User ID
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      token, 
      customer_type_id, 
      company_id, 
      customer_name, 
      phone, 
      items 
    } = body;

    // ⛔ ผมคอมเมนต์ 3 บรรทัดนี้ออก เพื่อปิดด่านตรวจ Token ชั่วคราวครับ
    // if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    // if (authError || !user) return NextResponse.json({ error: 'Invalid Token' }, { status: 401 });

    // ✅ ผมแปะ User ID ของพี่ลงไปตรงนี้แทนครับ
    const user = { id: '38bfe943-d3fd-4e40-ac88-7e39dff9b903' };

    // 🔥 2. เพิ่มส่วนนี้: ไปหา team_id ของ User คนนี้จากตาราง profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('team_id')
      .eq('id', user.id)
      .single();

    const team_id = profile?.team_id;

    // 📝 3. บันทึกลงตาราง orders (เพิ่ม team_id ลงไปตรงนี้)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: user.id,
        team_id: team_id, // ✅ บันทึก team_id ที่ดึงมาได้ลงไปด้วย
        customer_type_id,
        company_id,
        customer_name,
        phone,
      })
      .select()
      .single();

    if (orderError) throw orderError;
    
    // 📦 3. วนลูปบันทึก "รายการสินค้า" (Items)
    if (items && items.length > 0) {
      for (const item of items) {
        
        // 📸 3.1 อัปโหลดรูปภาพ (รักษา Logic เดิมครบ 100%)
        let itemImageUrls: string[] = [];
        
        if (item.images && Array.isArray(item.images) && item.images.length > 0) {
          for (let i = 0; i < item.images.length; i++) {
            const base64Data = item.images[i];
            
            // ตั้งชื่อไฟล์: orderID_เวลา_ลำดับรูป.webp
            const fileName = `order_${order.id}_${Date.now()}_${i}.webp`;
            
            // แปลง Base64 กลับเป็น Buffer
            const buffer = Buffer.from(base64Data, 'base64');

            // อัปโหลดขึ้น Supabase Storage (Bucket 'orders')
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

        // 📝 3.2 บันทึกสินค้าลง order_items (พร้อม URL รูปภาพ)
        const { data: savedItem, error: itemError } = await supabase
          .from('order_items')
          .insert({
            order_id: order.id,
            product_category_id: item.product_category_id,
            
            // ✅ เพิ่มบรรทัดนี้ครับ
            interest_level: item.interest_level, 

            note: item.note,
            images: itemImageUrls 
          })
          .select()
          .single();

        if (itemError) throw itemError;

        // 🏗️ 3.3 บันทึกการใช้โครงการ + พื้นที่ (order_item_projects)
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

    // ⚡⚡⚡ โค้ดส่วน Google Sheets ทั้งหมดถูกตัดออกไปแล้ว! ⚡⚡⚡
    // เพื่อให้ทำงานตามคอนเซ็ปต์ "Supabase บันทึกแล้วจบเลย ค่อยให้ Sheet มาดูด"

    // ตอบกลับแอปว่าบันทึกสำเร็จ (จบการทำงาน)
    return NextResponse.json({ success: true, orderId: order.id });

  } catch (err: any) {
    console.error("API Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}