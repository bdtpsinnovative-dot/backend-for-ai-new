import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'กรุณาล็อกอินก่อน' }, { status: 401 });
    }

    const { data: { user } } = await supabase.auth.getUser(token);
    
    if (!user) {
      return NextResponse.json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' }, { status: 401 });
    }

    const currentUserId = user.id;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // 📥 1. ดึงข้อมูลทั้งหมดมาก่อน (เพิ่ม is_deleted เข้าไปใน select ด้วย)
    const { data, error } = await supabase
      .from('orders')
      .select(`
        id, 
        created_at, 
        customer_name,
        companies(name),
        order_items (
          id, 
          interest_level,
          images,
          product_categories(name),
          order_item_projects (
            id,
            area_sqm,
            project_name,
            is_deleted 
          )
        )
      `)
      .eq('user_id', currentUserId)
      // ❌ เอา .eq ของ is_deleted ตรงนี้ออกไป เพื่อป้องกันบั๊กข้อมูลหาย
      .order('created_at', { ascending: false })
      .range(from, to);
  
    if (error) throw error;

    // 🌟 2. ท่าไม้ตาย: ใช้ JavaScript กรองโครงการที่ถูกลบออก (ชัวร์ 100%)
    const safeData = data.map((order: any) => {
      return {
        ...order,
        order_items: order.order_items.map((item: any) => {
          return {
            ...item,
            // 🛡️ เก็บเฉพาะโครงการที่ค่า is_deleted ไม่ใช่ true (ครอบคลุมทั้งค่า false และ null)
            order_item_projects: item.order_item_projects.filter(
              (proj: any) => proj.is_deleted !== true
            )
          };
        })
      };
    });

    // 📤 3. ส่งข้อมูลที่กรองแล้วกลับไปให้หน้าแอป
    return NextResponse.json(safeData);

  } catch (error: any) {
    console.error('Full Error Details:', error); 
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}