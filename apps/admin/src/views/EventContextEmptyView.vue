<script setup lang="ts">
defineProps<{ eventId: number | undefined; loadFailed: boolean }>();
</script>

<template>
  <section class="admin-state">
    <span class="admin-state__mark" aria-hidden="true">{{ loadFailed ? '↻' : '◇' }}</span>
    <p class="eyebrow">EVENT CONTEXT</p>
    <h1>{{ loadFailed ? '大会信息暂时无法载入' : '未找到这场大会' }}</h1>
    <p v-if="loadFailed">请检查服务连接后重试，或返回大会管理选择其他大会。</p>
    <p v-else>
      当前地址中的大会标识为 <code>{{ eventId }}</code>，它可能已归档或不在当前组织中。
    </p>
    <div class="admin-state__actions">
      <RouterLink class="button" :to="{ name: 'manage-events' }">返回大会管理</RouterLink>
      <button v-if="loadFailed" class="button secondary" type="button" @click="$router.go(0)">
        重新载入
      </button>
    </div>
  </section>
</template>
