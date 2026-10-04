<script lang='ts'>
  import type { MediaInfo } from './util'
  import type { ResolvedFile } from './resolver'

  import { goto } from '$app/navigation'
  import EpisodesList from '$lib/components/EpisodesList.svelte'
  import * as Sheet from '$lib/components/ui/sheet'
  import { client } from '$lib/modules/anilist'
  import { episodes as eps } from '$lib/modules/anizip'
  import { click } from '$lib/modules/navigate'

  export let portal: HTMLElement
  let episodeListOpen = false

  export let mediaInfo: MediaInfo
  export let videoFiles: ResolvedFile[] = []
  export let selectFile: ((file: ResolvedFile) => void) | undefined = undefined

  let activeTab: 'episodes' | 'files' = 'episodes'

  function formatBytes(bytes: number) {
    if (!bytes) return ''
    const mb = bytes / (1024 * 1024)
    if (mb > 1024) return (mb / 1024).toFixed(2) + ' GB'
    return mb.toFixed(1) + ' MB'
  }
</script>

<div class='text-foreground text-lg font-normal leading-none line-clamp-1 hover:text-muted-foreground hover:underline cursor-pointer text-shadow-lg' use:click={() => goto(`/#/app/anime/${mediaInfo.media.id}`)}>
  {mediaInfo.session.title}
</div>

<Sheet.Root {portal} bind:open={episodeListOpen}>
  <Sheet.Trigger class='text-[rgba(217,217,217,0.6)] hover:text-muted-foreground text-sm leading-none font-light line-clamp-1 text-left hover:underline bg-transparent text-shadow-lg'>
    {mediaInfo.session.description}
  </Sheet.Trigger>
  <Sheet.Content class='w-full sm:w-[580px] p-0 max-w-full sm:max-size-full overflow-y-hidden flex flex-col !pb-0 shrink-0 gap-0 bg-background justify-between overflow-x-clip'>
    
    <!-- Tab Switcher -->
    <div class="flex items-center gap-2 px-6 pt-5 pb-3 border-b border-border/50 shrink-0 bg-muted/20">
      <button 
        class="text-xs sm:text-sm font-medium px-3.5 py-1.5 rounded-md transition-all {activeTab === 'episodes' ? 'bg-primary text-primary-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
        on:click={() => activeTab = 'episodes'}
      >
        AniList Episodes
      </button>
      <button 
        class="text-xs sm:text-sm font-medium px-3.5 py-1.5 rounded-md transition-all {activeTab === 'files' ? 'bg-primary text-primary-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
        on:click={() => activeTab = 'files'}
      >
        Torrent Files ({videoFiles.length})
      </button>
    </div>

    <!-- Tab 1: AniList Episodes -->
    {#if activeTab === 'episodes'}
      <div class='flex-1 overflow-y-auto' on:wheel|stopPropagation>
        {#if mediaInfo.media}
          {#await Promise.all([eps(mediaInfo.media.id), client.single(mediaInfo.media.id)]) then [eps, media]}
            {#if media.data?.Media}
              <EpisodesList {eps} media={media.data.Media} class='!px-0 !py-3 xs:!p-3 sm:!p-6 !mx-0' />
            {/if}
          {/await}
        {/if}
      </div>
    {/if}

    <!-- Tab 2: Raw Torrent Files (OVAs, Specials, Extras, Multi-Season Files) -->
    {#if activeTab === 'files'}
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-1.5" on:wheel|stopPropagation>
        {#if videoFiles.length === 0}
          <div class="text-center text-muted-foreground text-sm py-8">
            No video files found in torrent.
          </div>
        {:else}
          {#each videoFiles as vf}
            <button
              class="flex items-center justify-between gap-3 text-left px-3.5 py-2.5 rounded-lg border border-border/40 hover:bg-accent/60 hover:border-border transition-all text-sm group {vf.name === mediaInfo.file.name ? 'border-primary/80 bg-primary/10' : 'bg-card/40'}"
              on:click={() => {
                if (selectFile) {
                  selectFile(vf)
                  episodeListOpen = false
                }
              }}
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="text-base shrink-0 {vf.name === mediaInfo.file.name ? 'text-primary' : 'text-muted-foreground'}">
                  {vf.name === mediaInfo.file.name ? '▶' : '📄'}
                </span>
                <span class="truncate font-mono text-xs sm:text-sm text-foreground/90 group-hover:text-foreground">
                  {vf.name}
                </span>
              </div>
              {#if vf.length}
                <span class="text-xs text-muted-foreground shrink-0 font-medium">
                  {formatBytes(vf.length)}
                </span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    {/if}

  </Sheet.Content>
</Sheet.Root>
