// app/api/v1/orders/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      token, user_id, customer_type_id, company_id, 
      customer_name, phone, items, audit_log 
    } = body;

    let currentUserId = user_id;

    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) currentUserId = user.id;
    }

    let team_id = null;
    let companyName = null;
    let typeName = '';

    const [profileRes, companyRes, typeRes] = await Promise.all([
      currentUserId ? supabase.from('profiles').select('team_id').eq('id', currentUserId).maybeSingle() : Promise.resolve({ data: null }),
      company_id ? supabase.from('companies').select('name').eq('id', company_id).maybeSingle() : Promise.resolve({ data: null }),
      customer_type_id ? supabase.from('customer_types').select('name').eq('id', customer_type_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    team_id = profileRes.data?.team_id;
    companyName = companyRes.data?.name;
    typeName = typeRes.data?.name || '';

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

    // 📝 1. บันทึก Order หลัก
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: currentUserId || null,
        team_id: team_id || null, 
        company_id: company_id || null,
        customer_type_id: customer_type_id || null,
        customer_name: customer_name || null,
        phone: phone || null,
        audit_log: audit_log ? { ...audit_log, network: { ip: ip } } : null
      })
      .select().single();

    if (orderError) throw orderError;
    
    // 📦 2. ตรวจสอบ Items ที่ส่งมา
    // 🌟 ถ้าเซลล์ไม่ได้กดเพิ่ม Item เลย (items ว่างเปล่า) เราจำลอง Item ปลอมขึ้นมา 1 อัน เพื่อให้มันไปสร้าง Project ต่อได้
    let orderItemsToProcess = items && Array.isArray(items) && items.length > 0 ? items : [{}];

    const { data: allProjects } = await supabase.from('projects').select('id, project_name');
    const projectMap = new Map(allProjects?.map(p => [p.id, p.project_name]) || []);

    for (const item of orderItemsToProcess) {
        
      let itemImageUrls: string[] = [];
      if (item.images && Array.isArray(item.images)) {
        for (let i = 0; i < item.images.length; i++) {
          try {
            const buffer = Buffer.from(item.images[i], 'base64');
            const fileName = `order_${order.id}_${Date.now()}_${i}.webp`;
            const { data: uploadData } = await supabase.storage.from('orders').upload(fileName, buffer, { contentType: 'image/webp' });
            if (uploadData) {
              const { data: publicUrl } = supabase.storage.from('orders').getPublicUrl(fileName);
              itemImageUrls.push(publicUrl.publicUrl);
            }
          } catch (e) { console.error("Skip Image"); }
        }
      }

      // 📝 3. เซฟเข้า order_items เสมอ (ต่อให้ไม่มีหมวดหมู่ก็ต้องสร้าง เพื่อเป็นสะพานไปหา Project)
      const { data: savedItem, error: itemError } = await supabase
        .from('order_items')
        .insert({
          order_id: order.id,
          product_category_id: item.product_category_id || null,
          interest_level: item.interest_level || null, 
          note: item.note || null,
          images: itemImageUrls 
        })
        .select().single();

      if (itemError) continue; // ถ้าพังจริงๆ ถึงจะข้าม

      // 🏗️ 4. จัดการ order_item_projects (หัวใจหลักของระบบพี่)
      let projectUsagePayload = [];
      const hasProjectUsage = item.project_usage && Array.isArray(item.project_usage) && item.project_usage.length > 0;

      if (hasProjectUsage) {
        // กรณีเซลล์เลือกโปรเจกต์มาปกติ
        projectUsagePayload = item.project_usage.map((usage: any) => {
          const pName = projectMap.get(usage.project_id) || '-';
          let projectRow: any = {
            order_item_id: savedItem.id,
            project_name: pName,
            area_sqm: usage.area_sqm ? parseFloat(usage.area_sqm) : 0
          };
          return injectCompanyNames(projectRow, typeName, companyName);
        });
      } else {
        // 🌟 กรณีเซลล์ไม่ได้เลือกโปรเจกต์เลย! สร้างโปรเจกต์ "ว่าง" ยัดให้ทันที (0 ตร.ม.)
        let fallbackProjectRow: any = {
            order_item_id: savedItem.id,
            project_name: 'ไม่มีการระบุโครงการ', // ระบุชื่อชัดเจน
            area_sqm: 0 // บังคับเป็น 0
        };
        projectUsagePayload.push(injectCompanyNames(fallbackProjectRow, typeName, companyName));
      }

      // บันทึกลงตาราง Order Item Projects
      await supabase.from('order_item_projects').insert(projectUsagePayload);
    }

    return NextResponse.json({ success: true, orderId: order.id });

  } catch (err: any) {
    console.error("API POST Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ฟังก์ชันช่วยเหลือสำหรับหยอดชื่อบริษัทลงช่อง Account (DRY Code)
function injectCompanyNames(projectRow: any, typeName: string, companyName: string | null) {
  const typeStr = typeName.toLowerCase();
  if (typeStr.includes('developer')) projectRow.account_developer = companyName;
  else if (typeStr.includes('architect')) projectRow.account_architecture = companyName;
  else if (typeStr.includes('interior')) projectRow.account_interior = companyName;
  else if (typeStr.includes('contractor') || typeStr.includes('turnkey') || typeStr.includes('builder')) {
    projectRow.account_contractor = companyName; 
  }
  return projectRow;
}