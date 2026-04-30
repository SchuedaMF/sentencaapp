import { redirect } from "next/navigation";

export default function QualidadePage() {
  redirect("/fila?stage=QUALIDADE&status=EM+ANDAMENTO");
}
