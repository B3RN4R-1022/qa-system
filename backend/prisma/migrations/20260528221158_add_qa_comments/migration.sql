-- CreateTable
CREATE TABLE "QAComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QAComment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "QAComment" ADD CONSTRAINT "QAComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "QATask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
