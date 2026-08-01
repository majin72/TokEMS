<template>
  <main class="admin-standalone-state">
    <RouterLink class="admin-state-brand" :to="{ name: 'manage-events' }">
      <span class="brand-mark" aria-hidden="true">G</span>
      <span>TokEMS 运营台</span>
    </RouterLink>
    <section class="admin-state">
      <span class="admin-state__code">404</span>
      <p class="eyebrow">PAGE NOT FOUND</p>
      <h1>这个页面已移动或不存在</h1>
      <p>后台已经采用新的两层导航结构，你可以从管理中心重新进入目标大会。</p>
      <div class="admin-state__actions">
        <RouterLink class="button" :to="{ name: 'manage-events' }">前往大会管理</RouterLink>
      </div>
    </section>
  </main>
</template>
