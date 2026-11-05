"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, LoaderCircle } from "lucide-react";

export interface ScheduleItem {
  id: string;
  niche: string;
  executionDate: string;
  targetCountry: string;
  targetAudience: string;
  language: string;
  researchIdeasCount: number;
  pinsToGenerate: number;
  status: string;
}

interface ScheduleListProps {
  initialSchedules: ScheduleItem[];
  totalCount: number;
}

export function ScheduleList({ initialSchedules, totalCount }: ScheduleListProps) {
  const router = useRouter();
  const [schedules, setSchedules] = useState<ScheduleItem[]>(initialSchedules);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(schedule: ScheduleItem) {
    if (
      !window.confirm(
        `Permanently delete the schedule "${schedule.niche}" (${schedule.executionDate.slice(
          0,
          10,
        )}) and its associated research/ideas? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingId(schedule.id);
    setError(null);

    try {
      const response = await fetch(`/api/schedules/${schedule.id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete schedule.");
      }

      setSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete schedule.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      {error && (
        <p className="feedback-message feedback-error" role="alert" style={{ marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Niche</th>
              <th>Execution date</th>
              <th>Country</th>
              <th>Audience</th>
              <th>Language</th>
              <th>Ideas</th>
              <th>Pins</th>
              <th>Status</th>
              <th style={{ textAlign: "right", width: "80px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((schedule) => {
              const isDeleting = deletingId === schedule.id;
              return (
                <tr key={schedule.id}>
                  <td>{schedule.niche}</td>
                  <td>{schedule.executionDate.slice(0, 10)}</td>
                  <td>{schedule.targetCountry}</td>
                  <td>{schedule.targetAudience}</td>
                  <td>{schedule.language}</td>
                  <td>{schedule.researchIdeasCount}</td>
                  <td>{schedule.pinsToGenerate}</td>
                  <td>
                    <span className="schedule-status">{schedule.status}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="secondary-button image-remove-button"
                      type="button"
                      disabled={isDeleting}
                      onClick={() => void handleDelete(schedule)}
                      title={`Delete schedule "${schedule.niche}"`}
                      style={{ padding: "0.3rem 0.5rem" }}
                    >
                      {isDeleting ? (
                        <LoaderCircle size={14} className="spinning" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalCount > schedules.length && (
        <p className="import-hint">
          Showing {schedules.length} of {totalCount} schedules.
        </p>
      )}
    </>
  );
}

