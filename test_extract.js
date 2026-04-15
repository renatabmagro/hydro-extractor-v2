import fetch from "node-fetch";

async function test() {
  await fetch("http://localhost:3000/api/gee/auth", { method: "POST" });
  const res = await fetch("http://localhost:3000/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: -23.5, lng: -45.5, basinName: "Test Basin" })
  });
  const data = await res.json();
  console.log(data);
}
test();
