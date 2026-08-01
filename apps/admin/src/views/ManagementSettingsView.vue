<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { session } from '../lib/api';
import { provideSettingsFormState } from '../composables/settings-form-state';

type SettingsItem = {
  name: string;
  label: string;
  description: string;
  grants: string[];
};

type SettingsGroup = {
  label: string;
  items: SettingsItem[];
};

const route = useRoute();
const router = useRouter();
const formState = provideSettingsFormState();

const groups: SettingsGroup[] = [
  {
    label: '组织',
    items: [
      {
        name: 'manage-settings-general',
        label: '组织与默认项',
        description: '组织资料、时区、币种与建会模板',
        grants: ['org.settings.read'],
      },
    ],
  },
  {
    label: '体验',
    items: [
      {
        name: 'manage-settings-website',
        label: '公开网站',
        description: '站点身份、搜索摘要与合规信息',
        grants: ['org.settings.read'],
      },
      {
        name: 'manage-settings-customers',
        label: '用户账号',
        description: '登录模式、用户协议与隐私政策',
        grants: ['org.settings.read'],
      },
    ],
  },
  {
    label: '服务',
    items: [
      {
        name: 'manage-settings-payment',
        label: '支付服务',
        description: '微信支付凭据、回调与连接验证',
        grants: ['org.settings.read'],
      },
      {
        name: 'manage-settings-sms',
        label: '短信服务',
        description: '阿里云短信、模板与发送测试',
        grants: ['org.settings.read'],
      },
      {
        name: 'manage-settings-analytics',
        label: '统计与数据',
        description: '公开端统计平台与加载范围',
        grants: ['org.settings.read'],
      },
      {
        name: 'manage-settings-integrations',
        label: '集成状态',
        description: '支付、通知、AI 与对象存储状态',
        grants: ['org.settings.read'],
      },
    ],
  },
  {
    label: '访问控制',
    items: [
      {
        name: 'manage-settings-team',
        label: '团队与权限',
        description: '组织成员、角色与访问范围',
        grants: ['org.member.read'],
      },
    ],
  },
];

const visibleGroups = computed(() =>
  groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => session.canAny(item.grants)),
    }))
    .filter((group) => group.items.length > 0),
);
const visibleItemCount = computed(() =>
  visibleGroups.value.reduce((total, group) => total + group.items.length, 0),
);
const currentItem = computed(() =>
  visibleGroups.value.flatMap((group) => group.items).find((item) => item.name === route.name),
);

function confirmUnsavedChanges() {
  if (formState.busy.value) {
    window.alert('设置正在保存，请等待操作完成后再离开。');
    return false;
  }
  return (
    !formState.dirty.value ||
    window.confirm('当前设置有未保存的更改。离开后这些更改会丢失，确定继续吗？')
  );
}

async function navigateFromSelect(event: Event) {
  const select = event.currentTarget as HTMLSelectElement;
  const name = select.value;
  if (!name || name === route.name) return;
  const failure = await router.push({ name });
  if (failure) select.value = String(route.name ?? '');
}

function markFormDirty(event: Event) {
  const target = event.target;
  if (target instanceof Element && target.closest('form[data-settings-form]')) {
    formState.markDirty();
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!formState.dirty.value && !formState.busy.value) return;
  event.preventDefault();
  event.returnValue = '';
}

onBeforeRouteUpdate((to, from) => {
  if (to.name === from.name) return true;
  return confirmUnsavedChanges();
});
onBeforeRouteLeave(() => confirmUnsavedChanges());

onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', handleBeforeUnload));
</script>

<template>
  <header class="settings-page-head reveal is-visible">
    <div>
      <p class="eyebrow">ORGANIZATION CONTROL</p>
      <p class="settings-page-title">系统设置</p>
      <p>管理组织级默认项、公开体验、服务连接与访问权限。</p>
    </div>
    <span class="settings-module-count">{{ visibleItemCount }} 个模块</span>
  </header>

  <label class="settings-mobile-switcher">
    <span>当前设置模块</span>
    <select :value="String(route.name ?? '')" @change="navigateFromSelect">
      <optgroup v-for="group in visibleGroups" :key="group.label" :label="group.label">
        <option v-for="item in group.items" :key="String(item.name)" :value="String(item.name)">
          {{ item.label }}
        </option>
      </optgroup>
    </select>
  </label>

  <div class="settings-layout">
    <aside class="settings-navigation" aria-label="系统设置模块">
      <div class="settings-navigation-context">
        <span>配置范围</span>
        <strong>当前组织</strong>
        <p>{{ currentItem?.description ?? '选择一个设置模块开始配置。' }}</p>
      </div>
      <nav>
        <section v-for="group in visibleGroups" :key="group.label" class="settings-nav-group">
          <p>{{ group.label }}</p>
          <RouterLink v-for="item in group.items" :key="item.name" :to="{ name: item.name }">
            <span>{{ item.label }}</span>
            <small>{{ item.description }}</small>
          </RouterLink>
        </section>
      </nav>
    </aside>

    <section
      class="settings-detail"
      aria-label="设置详情"
      @input.capture="markFormDirty"
      @change.capture="markFormDirty"
    >
      <RouterView />
    </section>
  </div>
</template>
