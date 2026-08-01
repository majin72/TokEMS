<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { IntegrationStatus } from '@conference/contracts';
import { conferenceApi } from '../lib/api';

const integrations = ref<IntegrationStatus>();
const loading = ref(true);
const loaded = ref(false);
const errorMessage = ref('');
const rows = computed(() => {
  const labels: Record<keyof IntegrationStatus, { name: string; description: string }> = {
    payment: { name: '支付服务', description: '微信 Native 扫码支付与异步回调' },
    notification: { name: '通知服务', description: '短信、邮件与通知任务' },
    ai: { name: 'AI 服务', description: '内容生成与运营辅助' },
    objectStorage: { name: '对象存储', description: '模板图片与导出文件' },
  };
  return (Object.keys(labels) as Array<keyof IntegrationStatus>).map((key) => ({
    key,
    ...labels[key],
    value: integrations.value?.[key],
  }));
});

async function load() {
  loading.value = true;
  loaded.value = false;
  errorMessage.value = '';
  try {
    integrations.value = await conferenceApi.getIntegrationStatus();
    loaded.value = true;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '服务状态读取失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
  <div v-if="loading" class="admin-loading">正在检查服务状态…</div>
  <div v-else-if="!loaded" class="admin-loading">
    <button class="btn btn-secondary" type="button" @click="load">重新载入</button>
  </div>

  <section v-else class="admin-panel settings-module">
    <header class="admin-panel-header settings-module-header">
      <div>
        <p class="settings-module-kicker">INTEGRATIONS</p>
        <h1>集成状态</h1>
        <p>查看组织正在使用的基础服务及其连接状态。</p>
      </div>
    </header>
    <ul class="integration-status-list settings-integration-list">
      <li v-for="item in rows" :key="item.key">
        <div>
          <strong>{{ item.name }}</strong>
          <span>{{ item.description }}</span>
        </div>
        <div class="settings-integration-action">
          <b class="status-badge" :class="item.value?.configured ? 'paid' : 'draft'">
            {{ item.value?.configured ? '已配置' : '待配置' }}
          </b>
          <RouterLink
            v-if="item.key === 'payment' || item.key === 'notification'"
            class="text-link"
            :to="{
              name: item.key === 'payment' ? 'manage-settings-payment' : 'manage-settings-sms',
            }"
          >
            {{ item.key === 'notification' ? '管理短信' : '管理' }}
          </RouterLink>
        </div>
      </li>
    </ul>
    <p class="settings-panel-note">
      支付与短信密钥可在对应模块中加密维护；邮件、AI 与对象存储继续由部署环境托管。
    </p>
  </section>
</template>
