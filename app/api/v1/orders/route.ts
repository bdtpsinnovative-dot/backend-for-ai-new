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
      user_id,
      customer_type_id, 
      company_id, 
      customer_name, 
      phone,            
      items,
      audit_log 
    } = body;

    let currentUserId = user_id;

    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) currentUserId = user.id;
    }

    if (!currentUserId) {
      return NextResponse.json({ error: 'Missing User ID or Token' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('team_id')
      .eq('id', currentUserId)
      .single();

    const team_id = profile?.team_id;

    // 🔍 1. เช็คชื่อประเภทลูกค้า
    const { data: typeData } = await supabase
      .from('customer_types')
      .select('name')
      .eq('id', customer_type_id)
      .single();
    const typeName = typeData?.name || ''; 

    // 🏢 2. ดึง "ชื่อบริษัท"
    let companyName = null;
    if (company_id) {
      const { data: compData } = await supabase
        .from('companies')
        .select('name')
        .eq('id', company_id)
        .single();
      if (compData) companyName = compData.name;
    }

    // 🌟 3. ดึง "ชื่อโปรเจกต์ทั้งหมด" มาเตรียมไว้ทำ Snapshot ฝังลงบิล
    const { data: allProjects } = await supabase.from('projects').select('id, project_name');
    const projectMap = new Map(allProjects?.map(p => [p.id, p.project_name]) || []);

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

    // 📝 4. บันทึกลงตาราง orders 
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: currentUserId,
        team_id: team_id, 
        company_id: company_id,
        customer_name: customer_name,
        phone: phone,
        audit_log: audit_log ? { ...audit_log, network: { ip: ip } } : null
      })
      .select()
      .single();

    if (orderError) throw orderError;
    
    // 📦 5. วนลูปบันทึกรายการสินค้า
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

        // 🏗️ 5. บันทึกตารางหลาน (เหลือแค่ชื่อโครงการ)
if (item.project_usage && item.project_usage.length > 0) {
  const projectUsagePayload = item.project_usage.map((usage: any) => {
    // 🎯 ดึงชื่อโครงการจาก Map หรือจากข้อมูลที่หน้าบ้านส่งมา
    const pName = projectMap.get(usage.project_id) || '-';

    let projectRow: any = {
      order_item_id: savedItem.id,
      project_name: pName, // 👈 ใช้ชื่อโครงการแทน ID แล้ว
      area_sqm: usage.area_sqm ? parseFloat(usage.area_sqm) : 0
    };

    const typeStr = typeName.toLowerCase();

    // Mapping ข้อมูล Account ตามประเภทลูกค้าเหมือนเดิม
    if (typeStr.includes('developer')) {
      projectRow.account_developer = companyName;
    } else if (typeStr.includes('architect')) {
      projectRow.account_architecture = companyName;
    } else if (typeStr.includes('interior')) {
      projectRow.account_interior = companyName;
    } else if (typeStr.includes('contractor') || typeStr.includes('turnkey') || typeStr.includes('home builder')) {
      projectRow.account_contractor = companyName; 
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