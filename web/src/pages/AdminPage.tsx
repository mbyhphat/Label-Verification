import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatSupabaseError } from '@/lib/supabase/errors'
import type {
  ExistingDatasetCheck,
  ImportFolder,
  ImportResult,
  LabelingProject,
} from '@/types/domain'
import {
  createProject,
  checkExistingDataset,
  importDataset,
  type ImportProgressUpdate,
} from '@/features/admin/api/import.api'
import { FolderUploadZone } from '@/features/admin/components/FolderUploadZone'
import { ImportPreview } from '@/features/admin/components/ImportPreview'
import { ImportProgress } from '@/features/admin/components/ImportProgress'
import { ProjectClassStatsPanel } from '@/features/admin/components/ProjectClassStatsPanel'
import { ProjectDecisionLeaderboardPanel } from '@/features/admin/components/ProjectDecisionLeaderboardPanel'
import { ProjectPiiConfigPanel } from '@/features/admin/components/ProjectPiiConfigPanel'

type AdminPageProps = {
  projects: LabelingProject[]
  adminProjectIds: Set<string>
  membershipsLoading: boolean
  membershipError: string
  onMembershipsChanged: () => Promise<void>
  onSignOut: () => void
}

export function AdminPage({
  projects,
  adminProjectIds,
  membershipsLoading,
  membershipError,
  onMembershipsChanged,
  onSignOut,
}: AdminPageProps) {
  const adminProjects = useMemo(
    () => projects.filter((project) => adminProjectIds.has(project.id)),
    [projects, adminProjectIds],
  )
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectSlug, setProjectSlug] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [folder, setFolder] = useState<ImportFolder | null>(null)
  const [existing, setExisting] = useState<ExistingDatasetCheck | null>(null)
  const [checkingExisting, setCheckingExisting] = useState(false)
  const [replace, setReplace] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgressUpdate | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [classStatsRefreshKey, setClassStatsRefreshKey] = useState(0)
  const [error, setError] = useState('')
  const activeProjectId =
    selectedProjectId && adminProjectIds.has(selectedProjectId)
      ? selectedProjectId
      : (adminProjects[0]?.id ?? '')

  useEffect(() => {
    let cancelled = false

    async function runCheck() {
      if (!activeProjectId || !folder || folder.issues.some((issue) => issue.level === 'error')) {
        setExisting(null)
        return
      }

      setCheckingExisting(true)
      try {
        const nextExisting = await checkExistingDataset(activeProjectId, folder)
        if (!cancelled) setExisting(nextExisting)
      } catch (err) {
        if (!cancelled) setError(formatSupabaseError(err))
      } finally {
        if (!cancelled) setCheckingExisting(false)
      }
    }

    void runCheck()
    return () => {
      cancelled = true
    }
  }, [activeProjectId, folder])

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreatingProject(true)
    setError('')
    try {
      const project = await createProject({
        slug: projectSlug,
        name: projectName,
        description: projectDescription || null,
      })
      await onMembershipsChanged()
      setSelectedProjectId(project.id)
      setProjectName('')
      setProjectSlug('')
      setProjectDescription('')
      setShowCreateProject(false)
    } catch (err) {
      setError(formatSupabaseError(err))
    } finally {
      setCreatingProject(false)
    }
  }

  async function handleImport() {
    if (!folder || !activeProjectId) return
    setImporting(true)
    setError('')
    setImportProgress(null)
    setResult(null)
    try {
      const nextResult = await importDataset({
        projectId: activeProjectId,
        folder,
        replace,
        onProgress: setImportProgress,
      })
      setResult(nextResult)
      setReplace(false)
      setClassStatsRefreshKey((value) => value + 1)
      setExisting(await checkExistingDataset(activeProjectId, folder))
      setImportProgress(null)
    } catch (err) {
      setError(formatSupabaseError(err))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <AppHeader canShowAdmin onSignOut={onSignOut} />

      <main className="flex min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-5">
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0 flex-1">
                <Label className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">
                  Project
                </Label>
                <Select
                  value={activeProjectId}
                  onValueChange={(value) => setSelectedProjectId(value ?? '')}
                  disabled={membershipsLoading || adminProjects.length === 0}
                >
                  <SelectTrigger className="w-full max-w-xl">
                    <SelectValue placeholder={membershipsLoading ? 'Loading projects' : 'Select project'} />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {adminProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(membershipError || error) && (
                  <p className="mt-2 text-sm text-destructive">{membershipError || error}</p>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateProject((value) => !value)}
              >
                <Plus />
                New project
              </Button>
            </div>

            {showCreateProject && (
              <form
                onSubmit={handleCreateProject}
                className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-[1fr_16rem_auto]"
              >
                <div>
                  <Label htmlFor="project-name">Name</Label>
                  <Input
                    id="project-name"
                    value={projectName}
                    onChange={(event) => {
                      const nextName = event.target.value
                      setProjectName(nextName)
                      if (!projectSlug) setProjectSlug(slugify(nextName))
                    }}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="project-slug">Slug</Label>
                  <Input
                    id="project-slug"
                    value={projectSlug}
                    onChange={(event) => setProjectSlug(slugify(event.target.value))}
                    required
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={creatingProject || !projectName || !projectSlug}>
                    {creatingProject ? <RefreshCw className="animate-spin" /> : <Plus />}
                    Create
                  </Button>
                </div>
                <div className="md:col-span-3">
                  <Label htmlFor="project-description">Description</Label>
                  <Input
                    id="project-description"
                    value={projectDescription}
                    onChange={(event) => setProjectDescription(event.target.value)}
                  />
                </div>
              </form>
            )}
          </section>

          {activeProjectId && (
            <>
              <ProjectPiiConfigPanel
                projectId={activeProjectId}
                onConfigChanged={() => setClassStatsRefreshKey((value) => value + 1)}
              />
              <ProjectClassStatsPanel
                key={activeProjectId}
                projectId={activeProjectId}
                refreshKey={classStatsRefreshKey}
              />
              <ProjectDecisionLeaderboardPanel
                key={`${activeProjectId}-leaderboard`}
                projectId={activeProjectId}
                refreshKey={classStatsRefreshKey}
              />
            </>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-5">
              <FolderUploadZone
                folder={folder}
                onFolderParsed={(nextFolder) => {
                  setFolder(nextFolder)
                  setExisting(null)
                  setResult(null)
                  setImportProgress(null)
                  setError('')
                }}
              />
              <ImportProgress result={result} error={error && !membershipError ? error : ''} progress={importProgress} />
            </div>

            {folder ? (
              <ImportPreview
                folder={folder}
                existing={existing}
                checkingExisting={checkingExisting}
                replace={replace}
                importing={importing}
                onReplaceChange={setReplace}
                onImport={handleImport}
              />
            ) : (
              <section className="rounded-lg border border-border bg-card p-6">
                <p className="text-sm text-muted-foreground">Waiting for a folder.</p>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
