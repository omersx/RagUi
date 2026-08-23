"use client";

import { useCallback, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_MB } from "@/lib/constants";
import { toast } from "@/stores/toastStore";

interface DropZoneProps {
  disabled?: boolean;
  onFileSelected: (file: File) => void;
}

export default function DropZone({ disabled, onFileSelected }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = useCallback((file: File): boolean => {
    const name = file.name.toLowerCase();
    const ext = ALLOWED_EXTENSIONS.find((e) => name.endsWith(e));
    if (!ext) {
      toast("error", `Unsupported file type "${name.split(".").pop()}". Allowed: PDF, DOCX, HTML, PPTX, MD.`);
      return false;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast("error", `File is too large (${(file.size / 1048576).toFixed(1)}MB). Max ${MAX_UPLOAD_MB}MB.`);
      return false;
    }
    return true;
  }, []);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length || disabled) return;
      const file = files[0];
      if (validate(file)) onFileSelected(file);
    },
    [disabled, onFileSelected, validate]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload documents"
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) inputRef.current?.click();
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current++;
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (--dragCounter.current <= 0) {
          dragCounter.current = 0;
          setIsDragging(false);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`flex h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all duration-200 ${
        isDragging
          ? "border-zinc-500 bg-zinc-900"
          : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/70"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <div
        className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-400 transition-transform duration-200 ${
          isDragging ? "scale-110" : ""
        }`}
      >
        <FileUp size={22} />
      </div>
      <p className="text-sm font-medium text-zinc-200">
        {isDragging ? "Drop to upload" : "Drop files here or click to browse"}
      </p>
      <p className="mt-2 text-xs text-zinc-600">
        PDF · DOCX · HTML · PPTX · MD — max {MAX_UPLOAD_MB}MB
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_EXTENSIONS.join(",")}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
