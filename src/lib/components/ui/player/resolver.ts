import type { MediaEdgeFrag } from '$lib/modules/anilist/queries'
import type { AnitomyResult } from 'anitomyscript'
import type { ResultOf } from 'gql.tada'
import type { TorrentFile } from 'native'

import { client, episodes, removeDiacritics, type Media } from '$lib/modules/anilist'
import { anitomyscript, videoRx } from '$lib/utils'

export type ResolvedFile = TorrentFile & {
  metadata: {
    episode: string | number | undefined
    parseObject: AnitomyResult
    media: Media
    failed: boolean
  }
}

async function toResolvedFile (file: TorrentFile, media: Media): Promise<ResolvedFile> {
  const parseObject = (await anitomyscript([file.name]))[0]!
  return {
    ...file,
    metadata: {
      episode: Number(parseObject.episode_number?.[0]) || 0,
      parseObject,
      media,
      failed: false
    }
  }
}

export async function resolveFilesPoorly (
  promise: Promise<{ media: Media, id: string, episode: number, files: TorrentFile[] } | null>
) {
  const list = await promise
  if (!list) return

  const videoFiles: TorrentFile[] = []
  const otherFiles: TorrentFile[] = []
  for (const file of list.files) {
    if (videoRx.test(file.name)) {
      videoFiles.push(file)
    } else {
      otherFiles.push(file)
    }
  }

  const as = await anitomyscript(videoFiles.map(file => file.name))

  // Preserves ALL video files (does NOT drop OPs, EDs, OVAs, or specials)
  const parsedFiles = videoFiles.map((file, i) => ({ file, parseObject: as[i]! }))

  let resolvedFiles: ResolvedFile[] = parsedFiles.length === 1
    ? [{ metadata: { episode: list.episode, media: list.media, failed: false, parseObject: parsedFiles[0]!.parseObject }, ...parsedFiles[0]!.file }]
    : await AnimeResolver.resolveFileAnime(parsedFiles, list.media)

  // 1. Prioritize files that match the anime the user explicitly chose
  let targetAnimeFiles = resolvedFiles.filter(
    file => file.metadata.media.id && file.metadata.media.id === list.media.id
  )

  // 2. Multi-season batch fix: If no files matched directly, try matching season from filename/folder
  if (!targetAnimeFiles.length && list.media) {
    const seasonMatch = resolvedFiles.filter(file => {
      const seasonStr = file.metadata.parseObject.anime_season?.[0]
      const name = file.name.toLowerCase()
      // Check if file is tagged with S03 / Season 3 / 3
      return seasonStr
        ? name.includes(`s0${seasonStr}`) || name.includes(`s${seasonStr}`) || name.includes(`season ${seasonStr}`)
        : false
    })

    if (seasonMatch.length) {
      for (const f of seasonMatch) {
        f.metadata.media = list.media
      }
      targetAnimeFiles = seasonMatch
    }
  }

  // 3. Fallback: Strictly lock media to list.media so it NEVER redirects to Season 1
  if (!targetAnimeFiles.length) {
    for (const f of resolvedFiles) {
      f.metadata.media = list.media
    }
    targetAnimeFiles = resolvedFiles
  }

  targetAnimeFiles.sort((a, b) => Number(a.metadata.episode) - Number(b.metadata.episode))
  targetAnimeFiles.sort((a, b) => Number(b.metadata.parseObject.anime_season?.[0] ?? 1) - Number(a.metadata.parseObject.anime_season?.[0] ?? 1))

  const targetEpisode =
    targetAnimeFiles.find(file => file.metadata.episode === list.episode) ??
    targetAnimeFiles.find(file => file.metadata.episode === 1) ??
    targetAnimeFiles[0] ??
    resolvedFiles[0]

  if (!targetEpisode) return

  // Lock target media to what the user chose
  targetEpisode.metadata.media = list.media

  return {
    target: targetEpisode,
    targetAnimeFiles,
    otherFiles,
    resolvedFiles
  }
}

function highestOccurence<T> (arr: T[] = [], mapfn = (a: T) => ''): T | undefined {
  return arr.reduce<{ sums: Record<string, number>, max?: T }>((acc, el) => {
    const mapped = mapfn(el)
    acc.sums[mapped] = (acc.sums[mapped] ?? 0) + 1
    acc.max = (acc.max !== undefined ? acc.sums[mapfn(acc.max)]! : -1) > acc.sums[mapped] ? acc.max : el
    return acc
  }, { sums: {}, max: undefined }).max
}

const postfix: Record<number, string> = {
  1: 'st', 2: 'nd', 3: 'rd'
}

function * chunks<T> (arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) {
    yield arr.slice(i, i + size)
  }
}

const AnimeResolver = new class AnimeResolver {
  animeNameCache: Record<string, number> = {}

  getCacheKeyForTitle (obj: AnitomyResult): string {
    let key = removeDiacritics(obj.anime_title[0] ?? '')
    if (obj.anime_year.length) key += obj.anime_year[0]
    if (obj.anime_season.length) key += `S${obj.anime_season[0]}`
    return key
  }

  alternativeTitles (obj: AnitomyResult): string[] {
    const title = removeDiacritics(obj.anime_title[0] ?? '')
    const titles = new Set<string>()
    let modified = title

    const yearMatch = title.match(/\D(\d{4})$/)
    if (yearMatch && (!obj.anime_year.length || yearMatch[1] === obj.anime_year[0])) {
      modified = title.replace(/\D(\d{4})$/, '')
      titles.add(modified)
    }

    const seasonMatch = modified.match(/ S(\d+)/)
    if (obj.anime_season[0] && Number(obj.anime_season[0]) > 1) {
      modified = modified + ` ${Number(obj.anime_season[0])}${postfix[Number(obj.anime_season[0])] ?? 'th'} Season`
      titles.add(modified)
      titles.add(modified + ` Season ${Number(obj.anime_season[0])}`)
    } else if (seasonMatch) {
      if (Number(seasonMatch[1]) === 1) {
        modified = modified.replace(/ S(\d+)/, '')
        titles.add(modified)
      } else {
        modified = modified.replace(/ S(\d+)/, ` ${Number(seasonMatch[1])}${postfix[Number(seasonMatch[1])] ?? 'th'} Season`)
        titles.add(modified)
        titles.add(modified.replace(/ S(\d+)/, ` Season ${Number(seasonMatch[1])}`))
      }
    } else {
      titles.add(title)
    }

    const specialMatch = modified.match(/[-:]/g)
    if (specialMatch) {
      modified = modified.replace(/[-:]/g, '').replace(/[ ]{2,}/, ' ')
      titles.add(modified)
    }

    const tvMatch = modified.match(/\(TV\)/)
    if (tvMatch) {
      modified = modified.replace('(TV)', '')
      titles.add(modified)
    }

    return [...titles]
  }

  async findAnimesByTitle (parseObjects: AnitomyResult[]): Promise<void> {
    if (!parseObjects.length) return
    const titleObjects = parseObjects.map(obj => {
      const key = this.getCacheKeyForTitle(obj)
      const titleObjects = this.alternativeTitles(obj).map(title => ({ title, year: obj.anime_year[0], key, isAdult: false }))
      titleObjects.push({ ...titleObjects.at(-1)!, isAdult: true })
      return titleObjects
    }).flat()

    for (const chunk of chunks(titleObjects, 24)) {
      for (const [key, media] of await client.searchCompound(chunk)) {
        if (media?.id) this.animeNameCache[key] = media.id
      }
    }
  }

  async getAnimeById (id: number) {
    return (await client.single(id)).data?.Media as Media
  }

  async resolveFileAnime (
    files: Array<{ file: TorrentFile, parseObject: AnitomyResult }>,
    fallbackMedia: Media
  ) {
    if (!files.length) return []

    const uniq: Record<string, AnitomyResult> = {}
    for (const { parseObject } of files) {
      const key = this.getCacheKeyForTitle(parseObject)
      if (key in this.animeNameCache) continue
      uniq[key] = parseObject
    }
    await this.findAnimesByTitle(Object.values(uniq))

    const fileAnimes: ResolvedFile[] = []
    for (const { parseObject, file } of files) {
      let failed = false
      let episode: string | number | undefined
      const id = this.animeNameCache[this.getCacheKeyForTitle(parseObject)]

      // If AniList ID wasn't found, preserve the file instead of dropping it
      let media = id ? await this.getAnimeById(id) : fallbackMedia

      const maxep = episodes(media)
      if (parseObject.episode_number.length) {
        if (parseObject.episode_number.length > 1) {
          episode = `${parseObject.episode_number[0]} ~ ${parseObject.episode_number[1]}`
        } else {
          episode = Number(parseObject.episode_number[0])
        }
      }

      fileAnimes.push({
        ...file,
        metadata: {
          parseObject,
          episode: (episode ?? Number(parseObject.episode_number?.[0])) || 0,
          media,
          failed
        }
      })
    }
    return fileAnimes
  }
}()
