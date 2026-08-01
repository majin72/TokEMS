import type { OrganizationRole } from '@conference/contracts';

const organizationRoleLabels: Record<OrganizationRole, string> = {
  organization_admin: '组织管理员',
  event_owner: '大会负责人',
  finance: '财务',
  content_manager: '内容管理员',
  operator: '现场运营',
  viewer: '只读成员',
};

export function organizationRoleLabel(role?: OrganizationRole) {
  return role ? organizationRoleLabels[role] : '成员';
}
