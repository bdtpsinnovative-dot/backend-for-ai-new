// app/api/v1/orders/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

// ==================================================
// 🔔 1. เตรียมใช้งาน Firebase Admin (ทำแค่ครั้งเดียว)
// ==================================================
if (!admin.apps.length) {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (projectId && clientEmail && privateKey) {
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.substring(1, privateKey.length - 1);
      }
      privateKey = privateKey.replace(/\\n/g, '\n');

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: projectId,
          clientEmail: clientEmail,
          privateKey: privateKey,
        }),
      });
      console.log('✅ Firebase Admin Initialized Successfully!');
    } else {
      console.warn('⚠️ Missing Firebase Environment Variables.');
    }
  } catch (error) {
    console.error('❌ Firebase admin initialization error:', error);
  }
}

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
      currentUserId ? supabase.from('profiles').select('team_id, full_name').eq('id', currentUserId).maybeSingle() : Promise.resolve({ data: null }),
      company_id ? supabase.from('companies').select('name').eq('id', company_id).maybeSingle() : Promise.resolve({ data: null }),
      customer_type_id ? supabase.from('customer_types').select('name').eq('id', customer_type_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    team_id = profileRes.data?.team_id;
    companyName = companyRes.data?.name;
    typeName = typeRes.data?.name || '';
    const creatorName = profileRes.data?.full_name || 'เพื่อนร่วมทีม'; 

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

      if (itemError) continue;

      let projectUsagePayload = [];
      const hasProjectUsage = item.project_usage && Array.isArray(item.project_usage) && item.project_usage.length > 0;

      if (hasProjectUsage) {
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
        let fallbackProjectRow: any = {
            order_item_id: savedItem.id,
            project_name: 'ไม่มีการระบุโครงการ',
            area_sqm: 0 
        };
        projectUsagePayload.push(injectCompanyNames(fallbackProjectRow, typeName, companyName));
      }

      await supabase.from('order_item_projects').insert(projectUsagePayload);
    }

    // ==================================================
    // 🔔 5. สร้างประวัติแจ้งเตือนลง DB + ยิง FCM แบบแยกเงื่อนไข
    // ==================================================
    try {
      // 1. ดึงข้อมูล User ทุกคน (ยกเว้นตัวเอง) พร้อมค่า Setting
      const { data: allUsers } = await supabase
        .from('profiles')
        .select('id, fcm_token, team_id, noti_level, is_muted')
        .neq('id', currentUserId);

      if (allUsers && allUsers.length > 0) {
        // 2. กรองผู้ที่จะได้รับแจ้งเตือนตามเงื่อนไข
        const recipients = allUsers.filter(member => {
          if (member.noti_level === 'none') return false; 
          if (member.noti_level === 'all') return true;  
          if (member.noti_level === 'team' && member.team_id === team_id) return true; 
          return false;
        });

        if (recipients.length > 0) {
          const customerDisplay = companyName || customer_name || 'ลูกค้าทั่วไป';
          const title = 'ออเดอร์ใหม่เข้าทีม!';
          const bodyMsg = `${creatorName} เพิ่มรายการจาก ${customerDisplay}`;

          // บันทึกลงตาราง notifications
          const notificationPayloads = recipients.map(member => ({
            recipient_id: member.id,
            creator_id: currentUserId,
            title: title,
            body: bodyMsg,
            order_id: order.id
          }));

          const { error: dbError } = await supabase.from('notifications').insert(notificationPayloads);
          if (dbError) console.error("[DB] Error saving notification history:", dbError);

          // ส่ง FCM
          for (const target of recipients) {
            if (!target.fcm_token) continue;

            try {
              // 🌟 1. สร้างก้อนข้อมูลพื้นฐานที่จะส่งไปก่อน (มีแค่ข้อความ ไม่บอกเรื่องเสียง)
              const messagePayload: any = {
                token: target.fcm_token,
                notification: {
                  title: title,
                  body: bodyMsg,
                },
                data: {
                  orderId: order.id.toString(),
                  type: 'new_order'
                }
              };

              // 🌟 2. เช็กว่า "ถ้าไม่ได้ปิดเสียง (!target.is_muted)" ค่อยแนบคำสั่งเปิดเสียงเข้าไป
              if (!target.is_muted) {
                messagePayload.android = { notification: { sound: 'default' } };
                messagePayload.apns = { payload: { aps: { sound: 'default' } } };
              }

              // 🌟 3. ยิงเลย!
              await admin.messaging().send(messagePayload);
              
            } catch (fcmErr) {
              console.error(`[FCM] Failed to send to ${target.id}:`, fcmErr);
            }
          }
          console.log(`[FCM] ดำเนินการส่งแจ้งเตือนให้ผู้รับทั้งหมด ${recipients.length} คนเรียบร้อยครับนาย!`);
        }
      }
    } catch (err) {
      console.error('[FCM] Error process notifications:', err);
    }

    // 🌟 🌟 🌟 นี่คือส่วนที่โดนลบหายไปครับนาย! 🌟 🌟 🌟
    return NextResponse.json({ success: true, orderId: order.id });

  } catch (err: any) {
    console.error("API POST Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ฟังก์ชันช่วยเหลือสำหรับหยอดชื่อบริษัท
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