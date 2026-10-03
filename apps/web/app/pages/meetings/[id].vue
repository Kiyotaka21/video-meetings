<script setup lang="ts">
import type { MeetingFile } from '~/types/files'
import type { Meeting } from '~/types/meetings'
import { isUnauthorized, statusOf } from '~/utils/api'
import { checkFileBeforeUpload, describeFilesFailure, describeUploadFailure } from '~/utils/files'
import { describeMeetingFailure } from '~/utils/meetings'

// routeRules '/meetings/**' -> ssr: false: страница за авторизацией, токен
// лежит в куке и читается в браузере, индексировать здесь нечего.
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const toast = useToast()
const { logout } = useAuth()
const { fetchMeeting } = useMeetings()
const { fetchFiles } = useMeetingFiles()
const { upload, start: startUpload, cancel: cancelUpload } = useActiveUpload()

const meetingId = computed(() => String(route.params.id))

const meeting = shallowRef<Meeting | null>(null)
const files = shallowRef<MeetingFile[]>([])
const isLoading = shallowRef(true)
/** Встреча чужая или её нет — api отвечает одинаково, и это не ошибка загрузки. */
const isMissing = shallowRef(false)
const failure = shallowRef<string | null>(null)
const filesFailure = shallowRef<string | null>(null)

useSeoMeta({
  title: () =>
    meeting.value ? `${meeting.value.title} — Video Meetings` : 'Встреча — Video Meetings',
  robots: 'noindex',
})

/**
 * Токен в куке есть, middleware пропустил, а api его не принял: истёк, выпущен
 * против другой базы или учётку удалили. Это конец сессии, а не сбой запроса, —
 * та же ветка, что и в кабинете.
 */
const endSession = async () => {
  toast.add({
    title: 'Сессия истекла',
    description: 'Войдите снова, чтобы увидеть встречу.',
    color: 'warning',
    icon: 'i-lucide-clock-alert',
  })

  await logout()
}

/**
 * Встреча и файлы запрашиваются параллельно и разбираются порознь: отказ списка
 * файлов не должен прятать карточку встречи, которая уже пришла. Поэтому
 * `allSettled`, а не `all` — тот отбросил бы удачный ответ вместе с неудачным.
 */
const load = async () => {
  isLoading.value = true
  failure.value = null
  filesFailure.value = null
  isMissing.value = false

  const [meetingResult, filesResult] = await Promise.allSettled([
    fetchMeeting(meetingId.value),
    fetchFiles(meetingId.value),
  ])

  const unauthorized =
    (meetingResult.status === 'rejected' && isUnauthorized(meetingResult.reason)) ||
    (filesResult.status === 'rejected' && isUnauthorized(filesResult.reason))

  if (unauthorized) {
    isLoading.value = false
    await endSession()

    return
  }

  if (meetingResult.status === 'fulfilled') {
    meeting.value = meetingResult.value
  } else if (statusOf(meetingResult.reason) === 404) {
    isMissing.value = true
  } else {
    failure.value = describeMeetingFailure(meetingResult.reason)
  }

  if (filesResult.status === 'fulfilled') {
    files.value = filesResult.value
  } else if (statusOf(filesResult.reason) !== 404) {
    // 404 от списка — это та же пропавшая встреча, о которой уже сказано выше;
    // второе сообщение про файлы рядом с ним только путало бы.
    filesFailure.value = describeFilesFailure(filesResult.reason)
  }

  isLoading.value = false
}

onMounted(load)

const refuseUpload = (description: string) =>
  toast.add({
    title: 'Файл не загрузился',
    description,
    color: 'error',
    icon: 'i-lucide-triangle-alert',
  })

const onSelect = async (file: File, ignored: number) => {
  // Проверка до отправки: на отказе на api не уходит ни одного запроса.
  const refusal = checkFileBeforeUpload(file, files.value.length)

  if (refusal) {
    refuseUpload(refusal)

    return
  }

  // Бросили несколько разом — берём первый и говорим об этом, а не молчим:
  // иначе пользователь ждал бы, что уедут все.
  if (ignored > 0) {
    toast.add({
      title: 'Загружаем по одному файлу',
      description: `Взяли «${file.name}». Остальные (${ignored}) перетащите после него.`,
      color: 'info',
      icon: 'i-lucide-info',
    })
  }

  try {
    const uploaded = await startUpload(meetingId.value, file)

    // Отменил сам — строка загрузки уже пропала, сообщать нечего.
    if (!uploaded) {
      return
    }

    // Список не перезапрашиваем: api вернул метаданные ровно этого файла, а
    // сортировка по дате загрузки ставит его в конец — туда же, куда и мы.
    files.value = [...files.value, uploaded]

    toast.add({
      title: 'Файл загружен',
      description: uploaded.name,
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (error) {
    if (isUnauthorized(error)) {
      await endSession()

      return
    }

    refuseUpload(describeUploadFailure(error))
  }
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <UButton
      to="/"
      color="neutral"
      variant="link"
      icon="i-lucide-arrow-left"
      label="Все встречи"
      class="-mx-2.5 self-start"
    />

    <div v-if="isMissing" class="flex flex-col items-start gap-4">
      <h1 class="text-3xl font-semibold tracking-tight text-highlighted">Встреча не найдена</h1>
      <p class="text-muted">
        Возможно, её удалили или ссылка ведёт на чужую встречу — api не показывает встречи других
        пользователей.
      </p>
      <UButton to="/" label="К списку встреч" icon="i-lucide-calendar-days" />
    </div>

    <template v-else>
      <UAlert
        v-if="failure"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Встреча не загрузилась"
        :description="failure"
        :actions="[
          { label: 'Повторить', color: 'error', variant: 'outline', onClick: () => load() },
        ]"
      />

      <template v-else>
        <MeetingsMeetingCard :meeting="meeting" :pending="isLoading" />

        <!-- Блока с файлами при отказе по самой встрече нет вовсе: пустой
             список соврал бы, что файлов нет, а второй такой же алерт рядом —
             это одно и то же сообщение дважды. -->
        <FilesSection
          :files="files"
          :pending="isLoading"
          :failure="filesFailure"
          :upload="upload"
          @select="onSelect"
          @cancel="cancelUpload"
          @retry="load"
        />
      </template>
    </template>
  </div>
</template>
