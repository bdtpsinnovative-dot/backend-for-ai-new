import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      token, 
      user_id, // 👈 เพิ่มการรับ user_id จาก body (กรณีไม่ได้แนบ token)
      customer_type_id, 
      company_id, 
      customer_name, 
      phone,            
      items,
      audit_log 
    } = body;

    // 🧑‍💻 จัดการเรื่อง User ID (แบบไม่ล็อคตายตัว)
    let currentUserId = user_id;

    // ถ้ามีการส่ง token มา ให้ดึง user id จาก token เพื่อความปลอดภัย (แนะนำวิธีนี้)
    if (token) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (user) {
        currentUserId = user.id;
      }
    }

    // ถ้าไม่มี ID ส่งมาเลย ให้เตือนกลับไป
    if (!currentUserId) {
      return NextResponse.json({ error: 'Missing User ID or Token' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('team_id')
      .eq('id', currentUserId) // 👈 ใช้ ID ของคนที่ส่งเข้ามาจริงๆ
      .single();

    const team_id = profile?.team_id;

    // 🔍 1. เช็คชื่อประเภทลูกค้าก่อน
    const { data: typeData } = await supabase
      .from('customer_types')
      .select('name')
      .eq('id', customer_type_id)
      .single();
      
    const typeName = typeData?.name || ''; 

    // 😈 2. แอบดึง IP Address จริงของคนกดบันทึก
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

    // 📝 3. บันทึกลงตาราง orders (เพิ่ม audit_log ลง JSONB)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: currentUserId, // 👈 ใช้ ID ของคนที่ส่งเข้ามาจริงๆ
        team_id: team_id, 
        company_id: company_id,
        customer_name: customer_name,
        // ยัด Log ที่ส่งมา + เพิ่ม IP ของ Server เข้าไป
        audit_log: audit_log ? { ...audit_log, network: { ip: ip } } : null
      })
      .select()
      .single();

    if (orderError) throw orderError;
    
    // 📦 4. วนลูปบันทึกรายการสินค้า
    if (items && items.length > 0) {
      for (const item of items) {
        
        let itemImageUrls: string[] = [];
        if (item.images && Array.isArray(item.images) && item.images.length > 0) {
          for (let i = 0; i < item.images.length; i++) {
            const base64Data = item.images[i];
            const fileName = `order_${order.id}_${Date.now()}_${i}.webp`;
            const buffer = Buffer.from(base64Data, 'base64');

            const { data: uploadData, error: uploadError } = await supabase.storage
              .from('orders') 
              .upload(fileName, buffer, { contentType: 'image/webp', upsert: true });

            if (uploadError) continue; 
            if (uploadData) {
              const { data: publicUrl } = supabase.storage.from('orders').getPublicUrl(fileName);
              itemImageUrls.push(publicUrl.publicUrl);
            }
          }
        }

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

        // 🏗️ 5. บันทึกตารางหลาน
        if (item.project_usage && item.project_usage.length > 0) {
          const projectUsagePayload = item.project_usage.map((usage: any) => {
            let projectRow: any = {
              order_item_id: savedItem.id,
              project_id: usage.project_id,
              area_sqm: usage.area_sqm ? parseFloat(usage.area_sqm) : 0
            };

            if (typeName === 'Architect') projectRow.architect_name = phone;
            else if (typeName === 'Interior') projectRow.interior_name = phone;
            else if (typeName === 'Developer') projectRow.developer_name = phone;
            else if (typeName === 'TurnKey-TH') projectRow.turnkey_th_name = phone;
            else if (typeName === 'Inhouse Designer') projectRow.inhouse_designer_name = phone;
            else if (typeName === 'Designer') projectRow.designer_name = phone;
            else if (typeName === 'Home Builder') projectRow.home_builder_name = phone;
            else if (typeName === 'Architect, Interior') {
               projectRow.architect_name = phone;
               projectRow.interior_name = phone;
            }

            return projectRow;
          });

          const { error: usageError } = await supabase
            .from('order_item_projects')
            .insert(projectUsagePayload);

          if (usageError) throw usageError;
        }
      }
    }

    return NextResponse.json({ success: true, orderId: order.id });

  } catch (err: any) {
    console.error("API Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}