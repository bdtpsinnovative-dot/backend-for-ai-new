// app/api/v1/poolprojects/route.ts
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
      return NextResponse.json({ error: 'กรุณาล็อกอินก่อนเข้าใช้งาน' }, { status: 401 });
    }

    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return NextResponse.json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '150'); 
    const scope = searchParams.get('scope') || 'all'; 
    const searchKeyword = searchParams.get('search') || ''; 
    
    // ✅ รับค่า Filter ใหม่ที่ส่งมาจาก Flutter
    const categories = searchParams.get('categories');
    const sales = searchParams.get('sales');
    const types = searchParams.get('types');
    const areas = searchParams.get('areas');
    const dateRange = searchParams.get('dateRange');
    const isImportant = searchParams.get('isImportant') === 'true';

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: profileData } = await supabase
      .from('profiles')
      .select('team_id')
      .eq('id', user.id)
      .single();

    const selectCategories = categories ? 'product_categories!inner(name)' : 'product_categories(name)';
    const selectProjectTypes = types ? 'project_types!inner(name)' : 'project_types(name)';
    const selectProfiles = sales ? 'profiles!inner(full_name, teams(team_name))' : 'profiles(full_name, teams(team_name))';

    let query = supabase
      .from('order_items')
      .select(`
        *,
        ${selectCategories},
        order_item_projects!inner(
          id, 
          area_sqm, 
          project_name,
          is_important,
          project_type_id,
          ${selectProjectTypes},
          account_developer, 
          contact_developer,
          account_architecture, 
          contact_architecture,
          account_interior, 
          contact_interior,
          account_contractor, 
          contact_contractor,
          is_deleted
        ),
        orders!inner(
          id, 
          created_at, 
          customer_name, 
          phone,
          is_synced, 
          audit_log, 
          admin_edits,
          user_id, 
          team_id,
          ${selectProfiles},
          companies(name)
        )
      `, { count: 'exact' }) 
      .eq('order_item_projects.is_deleted', false) 
      .order('created_at', { ascending: false });

    if (scope === 'mine') {
      query = query.eq('orders.user_id', user.id); 
    } else if (scope === 'team' && profileData?.team_id) {
      query = query.eq('orders.team_id', profileData.team_id); 
    }

    if (searchKeyword.trim() !== '') {
      query = query.ilike('order_item_projects.project_name', `%${searchKeyword}%`);
    }

    if (categories) {
      query = query.in('product_categories.name', categories.split(','));
    }

    if (sales) {
      query = query.in('orders.profiles.full_name', sales.split(','));
    }

    if (types) {
      query = query.in('order_item_projects.project_types.name', types.split(','));
    }

    if (isImportant) {
      query = query.eq('order_item_projects.is_important', true);
    }

    if (dateRange) {
      const now = new Date();
      let daysToSubtract = 0;
      
      if (dateRange === '7 วันล่าสุด') daysToSubtract = 7;
      else if (dateRange === '14 วันล่าสุด') daysToSubtract = 14;
      else if (dateRange === '30 วันล่าสุด') daysToSubtract = 30;

      if (daysToSubtract > 0) {
        now.setDate(now.getDate() - daysToSubtract);
        query = query.gte('orders.created_at', now.toISOString());
      }
    }

    if (areas) {
      const areaArray = areas.split(',');
      let orConditions: string[] = [];

      for (const range of areaArray) {
        if (range === 'น้อยกว่า 50 sq.m.') orConditions.push(`area_sqm.lt.50`);
        else if (range === '50 - 200 sq.m.') orConditions.push(`and(area_sqm.gte.50,area_sqm.lte.200)`);
        else if (range === '201 - 500 sq.m.') orConditions.push(`and(area_sqm.gte.201,area_sqm.lte.500)`);
        else if (range === 'มากกว่า 500 sq.m.') orConditions.push(`area_sqm.gt.500`);
      }

      if (orConditions.length > 0) {
        query = query.or(orConditions.join(','), { foreignTable: 'order_item_projects' });
      }
    }

    const { data, count, error } = await query.range(from, to);

    if (error) throw error;
    
    return NextResponse.json({ 
      data: data, 
      total: count,
      page: page,
      limit: limit
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
export async function PATCH(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    const body = await request.json();
    const { 
      order_id, order_item_project_id, customer_name, phone,            
      project_name, area_sqm, product_category_id, project_type_id, is_important,
      account_developer, contact_developer, account_architecture, contact_architecture,
      account_interior, contact_interior, account_contractor, contact_contractor, note
    } = body;

    if (!token) return NextResponse.json({ error: 'กรุณาล็อกอินก่อนใช้งาน (ไม่พบ Token)' }, { status: 401 });
    if (!order_id) return NextResponse.json({ error: 'ต้องมีรหัส Order ID' }, { status: 400 });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single();
    const userRole = profile?.role || 'user';
    const editorName = profile?.full_name || 'Unknown Admin';

    const { data: existingOrder } = await supabase.from('orders').select('user_id, admin_edits, customer_name, phone').eq('id', order_id).single();

    let existingProject: any = {};
    let existingItem: any = {};

    if (order_item_project_id) {
      const { data: pData } = await supabase.from('order_item_projects').select('*').eq('id', order_item_project_id).single();
      existingProject = pData || {};

      if (existingProject.order_item_id) {
        const { data: iData } = await supabase.from('order_items').select('*').eq('id', existingProject.order_item_id).single();
        existingItem = iData || {};
      }
    }

    const isOwner = existingOrder?.user_id === user.id;
    const isAdmin = userRole === 'admin';

    if (!isOwner && !isAdmin) return NextResponse.json({ error: 'คุณไม่มีสิทธิ์แก้ไขรายการนี้' }, { status: 403 });

    // 🌟 1. ตัวเช็คว่าเปลี่ยนไหม? (✨ อุดรอยรั่วเรื่อง undefined แล้ว!)
    const isChanged = (newVal: any, oldVal: any) => {
      if (newVal === undefined) return false;
      if (typeof newVal === 'boolean') return newVal !== oldVal;
      
      // ดักจับ null และ undefined ให้กลายเป็นค่าว่าง '' ไปเลย ระบบจะได้ไม่งง
      const n = newVal === null || newVal === undefined ? '' : String(newVal).trim();
      const o = oldVal === null || oldVal === undefined ? '' : String(oldVal).trim();
      return n !== o;
    };

    // 🌟 2. วุ้นแปลภาษา (✨ ถ้าลบข้อความ จะบอกว่า "ลบ..." ชัดเจน)
    const getChangeText = (label: string, oldVal: any, newVal: any) => {
      if (typeof newVal === 'boolean') return newVal ? `ติดดาว ⭐️` : `ปลดดาว ❌`;
      
      const o = oldVal === null || oldVal === undefined ? '' : String(oldVal).trim();
      const n = newVal === null || newVal === undefined ? '' : String(newVal).trim();
      
      if (o === '' && n !== '') return `เพิ่ม${label}เป็น "${n}"`;
      if (o !== '' && n === '') return `ลบ${label} (เดิมคือ "${o}")`;
      return `เปลี่ยน${label}จาก "${o}" เป็น "${n}"`;
    };

    const changesMade: Record<string, any> = {};
    const detailTags: string[] = [];
    let orderUpdateData: any = {};
    let projectUpdateData: any = {};
    let itemUpdateData: any = {};

    const checkAndLog = (field: string, label: string, newVal: any, oldVal: any, targetDataObj: any) => {
      if (isChanged(newVal, oldVal)) {
        targetDataObj[field] = newVal;
        detailTags.push(getChangeText(label, oldVal, newVal));
        changesMade[field] = { from: oldVal, to: newVal }; 
      }
    };

    const getNameFromId = async (tableName: string, id: any) => {
      if (!id) return '';
      const { data } = await supabase.from(tableName).select('name').eq('id', id).single();
      return data?.name || String(id); 
    };

    const checkAndLogFK = async (field: string, label: string, tableName: string, newVal: any, oldVal: any, targetDataObj: any) => {
      if (isChanged(newVal, oldVal)) {
        targetDataObj[field] = newVal;
        const oldName = await getNameFromId(tableName, oldVal);
        const newName = await getNameFromId(tableName, newVal);
        detailTags.push(getChangeText(label, oldName, newName));
        changesMade[field] = { from_id: oldVal, to_id: newVal, from_name: oldName, to_name: newName }; 
      }
    };

    checkAndLog('customer_name', 'ชื่อลูกค้า', customer_name, existingOrder?.customer_name, orderUpdateData);
    checkAndLog('phone', 'เบอร์โทร', phone, existingOrder?.phone, orderUpdateData);
    checkAndLog('project_name', 'ชื่อโครงการ', project_name, existingProject?.project_name, projectUpdateData);
    checkAndLog('area_sqm', 'พื้นที่', area_sqm, existingProject?.area_sqm, projectUpdateData);
    checkAndLog('is_important', 'สถานะ', is_important, existingProject?.is_important, projectUpdateData);
    checkAndLog('account_developer', 'บ. Developer', account_developer, existingProject?.account_developer, projectUpdateData);
    checkAndLog('contact_developer', 'ติดต่อ Developer', contact_developer, existingProject?.contact_developer, projectUpdateData);
    checkAndLog('account_architecture', 'บ. Architect', account_architecture, existingProject?.account_architecture, projectUpdateData);
    checkAndLog('contact_architecture', 'ติดต่อ Architect', contact_architecture, existingProject?.contact_architecture, projectUpdateData);
    checkAndLog('account_interior', 'บ. Interior', account_interior, existingProject?.account_interior, projectUpdateData);
    checkAndLog('contact_interior', 'ติดต่อ Interior', contact_interior, existingProject?.contact_interior, projectUpdateData);
    checkAndLog('account_contractor', 'บ. Contractor', account_contractor, existingProject?.account_contractor, projectUpdateData);
    checkAndLog('contact_contractor', 'ติดต่อ Contractor', contact_contractor, existingProject?.contact_contractor, projectUpdateData);
    checkAndLog('note', 'หมายเหตุ', note, existingItem?.note, itemUpdateData);

    await checkAndLogFK('project_type_id', 'ประเภทโครงการ', 'project_types', project_type_id, existingProject?.project_type_id, projectUpdateData);
    await checkAndLogFK('product_category_id', 'ประเภทสินค้า', 'product_categories', product_category_id, existingItem?.product_category_id, itemUpdateData);

    if (isAdmin && detailTags.length > 0) {
      let currentAdminEdits = existingOrder?.admin_edits || [];
      if (!Array.isArray(currentAdminEdits)) currentAdminEdits = [];
      
      const newLogEntry = {
        action: 'admin_edit',
        is_self_edit: isOwner,
        editor_id: user.id,
        editor_name: editorName,
        edited_at: new Date().toISOString(),
        details: `แก้ไข: ${detailTags.join(', ')}`,
        changed_data: changesMade 
      };

      currentAdminEdits.push(newLogEntry);
      orderUpdateData.admin_edits = currentAdminEdits;
    }

    if (Object.keys(orderUpdateData).length > 0) {
      orderUpdateData.is_synced = false;
      const { error: orderError } = await supabase.from('orders').update(orderUpdateData).eq('id', order_id);
      if (orderError) throw orderError;
    }

    if (Object.keys(itemUpdateData).length > 0) {
      const { error: noteError } = await supabase.from('order_items').update(itemUpdateData).eq('order_id', order_id); 
      if (noteError) throw noteError;
    }

    if (Object.keys(projectUpdateData).length > 0 && order_item_project_id) {
      const { error: relationError } = await supabase.from('order_item_projects').update(projectUpdateData).eq('id', order_item_project_id);
      if (relationError) throw relationError;
    }

    if (detailTags.length === 0) {
      return NextResponse.json({ message: 'ไม่มีข้อมูลเปลี่ยนแปลง' });
    }

    return NextResponse.json({ message: 'อัปเดตข้อมูลและบันทึกประวัติสำเร็จ' });

  } catch (error: any) {
    console.error('Update Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}