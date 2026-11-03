<script setup lang="ts">
// The build renders the year it was built in; the browser replaces it with the reader's
// current year, so the line stays current without a rebuild. data-allow-mismatch lets
// hydration accept that difference.
const year = new Date().getFullYear()
</script>

<template>
  <p class="site-copyright">
    ©<span data-allow-mismatch="text">{{ year }}</span> FooQoo
  </p>
</template>

<style scoped>
.site-copyright {
  margin: 0;
  padding: 24px 0;
  border-top: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}
</style>
