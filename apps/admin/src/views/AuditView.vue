<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { conferenceApi, session } from '../lib/api';
import { dateTime } from '../lib/format';

const rows = ref<Array<Record<string, unknown>>>([]);
const pending = ref(false);
const loading = ref(true);
const errorMessage = ref('');

async function load() {
  loading.value = true;
  errorMessage.value = '';
  try {
    rows.value = await conferenceApi.getAuditLogs();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '审计日志读取失败';
  } finally {
    loading.value = false;
  }
}

async function exportData() {
  pending.value = true;
  try {
    await conferenceApi.exportRegistrations();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '导出失败';
  } finally {
    pending.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <header class="admin-page-head reveal is-visible">
    <div>
      <p class="eyebrow">TRACEABLE OPERATIONS</p>
      <h1>审计日志与数据导出</h1>
      <p>关键写操作记录操作者、资源、前后状态和追踪标识，导出文件内置范围水印。</p>
    </div>
    <div class="admin-head-actions">
      <button class="button secondary" type="button" @click="load">刷新日志</button><button
        v-if="session.can('event.registration.export')"
        class="button"
        type="button"
        :disabled="pending"
        @click="exportData"
      >
        {{ pending ? '正在导出…' : '导出报名 CSV' }}
      </button>
    </div>
  </header>
  <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
  <section class="admin-panel">
    <header class="admin-panel-header">
      <div>
        <h2>最近审计事件</h2>
        <p>最多显示 300 条</p>
      </div>
      <span class="status-badge">{{ rows.length }} LOGS</span>
    </header>
    <div class="data-table-wrap">
      <table class="data-table">
        <caption class="sr-only">
          大会审计日志
        </caption>
        <thead>
          <tr>
            <th>时间</th>
            <th>操作</th>
            <th>资源</th>
            <th>操作者</th>
            <th>追踪标识</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rows" :key="String(item.id)">
            <td>{{ dateTime(String(item.createdAt)) }}</td>
            <td>
              <span class="row-title">{{ item.action }}</span>
            </td>
            <td>
              {{ item.resourceType }}<span class="row-sub mono-code">{{ item.resourceId }}</span>
            </td>
            <td>
              <span class="row-title">{{ item.actorName ?? '系统' }}</span>
              <span v-if="item.actorId" class="row-sub mono-code">用户 ID {{ item.actorId }}</span>
            </td>
            <td class="mono-code">{{ item.traceId }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="loading" class="admin-loading" role="status">正在读取审计日志…</div>
      <div v-else-if="!rows.length" class="admin-empty">当前大会暂无审计记录。</div>
    </div>
  </section>
</template>
