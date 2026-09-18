-- Kontrak API §5.13 `AdminInvite.emailSentAt`: waktu email undangan berhasil
-- dikirim (ADR K4, Resend). Model domain §3.1 hanya menyebut
-- `email_message_id` / `email_error`; keduanya tidak bisa menjawab "kapan
-- terkirim" tanpa menebak (`updated_at` berubah karena sebab lain), jadi
-- kolomnya ditambahkan lewat migrasi baru — migrasi lama tidak diubah.
--
-- Nullable tanpa default: undangan yang sudah ada tetap sah dan berarti
-- "belum/gagal terkirim", yang persis keadaan sebenarnya selama modul email
-- belum dibangun.
ALTER TABLE "invite" ADD COLUMN "email_sent_at" TIMESTAMPTZ;
