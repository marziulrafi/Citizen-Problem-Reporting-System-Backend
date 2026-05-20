require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const { connectMongo } = require("../config/database");
const { User, Team } = require("../models");
const { DHAKA_ZONES } = require("../constants/dhakaZones");

const CORE_USERS = [
  { name: "System Admin", email: "admin@cprs.gov.bd", password: "Admin@12345", role: "admin", departmentName: "CPRS HQ" },
  { name: "Content Moderator", email: "moderator@cprs.gov.bd", password: "Moderator@123", role: "moderator", departmentName: "Dhaka Moderation" },
  { name: "Demo Citizen", email: "citizen@example.com", password: "Citizen@123", role: "citizen" },
];

const TEAMS_PER_ZONE = 3;

async function upsertUser(data) {
  let user = await User.findOne({ email: data.email });
  if (!user) {
    user = await User.create(data);
    console.log(`Created: ${data.email}`);
  } else {
    Object.assign(user, data);
    if (data.password) user.password = data.password;
    await user.save();
    console.log(`Updated: ${data.email}`);
  }
  return user;
}

async function seed() {
  await connectMongo();

  for (const u of CORE_USERS) {
    await upsertUser(u);
  }

  const authorities = [];
  for (const zone of DHAKA_ZONES) {
    const auth = await upsertUser({
      name: `${zone.name} Authority`,
      email: `auth.${zone.id}@cprs.gov.bd`,
      password: "Authority@123",
      role: "authority",
      departmentName: "Dhaka City Corporation",
      zone: zone.id,
    });
    authorities.push({ zone, auth });
  }

  for (const { zone, auth } of authorities) {
    for (let n = 1; n <= TEAMS_PER_ZONE; n++) {
      let team = await Team.findOne({ name: `${zone.name} — Team ${n}`, supervisor: auth._id });
      if (!team) {
        team = await Team.create({
          name: `${zone.name} — Team ${n}`,
          description: `Field unit ${n} for ${zone.name}`,
          zone: zone.id,
          department: "Dhaka City Corporation",
          supervisor: auth._id,
          members: [],
        });
        console.log(`Created team: ${team.name}`);
      }

      const workerEmail = `${zone.id}.team${n}@cprs.gov.bd`;
      const worker = await upsertUser({
        name: `Worker ${zone.name} T${n}`,
        email: workerEmail,
        password: "Team@12345",
        role: "field_worker",
        departmentName: "Field Operations",
        zone: zone.id,
        team: team._id,
        supervisorId: auth._id,
      });

      await Team.findByIdAndUpdate(team._id, { $addToSet: { members: worker._id }, zone: zone.id });
    }
  }

  await mongoose.disconnect();
  console.log("\n=== CPRS Dhaka seed complete ===\n");
  console.log("Moderator:  moderator@cprs.gov.bd / Moderator@123");
  console.log("Citizen:    citizen@example.com / Citizen@123");
  console.log("\nZone authorities (password: Authority@123):");
  DHAKA_ZONES.forEach((z) => console.log(`  ${z.name.padEnd(20)} auth.${z.id}@cprs.gov.bd`));
  console.log("\nWorker teams (password: Team@12345):");
  DHAKA_ZONES.forEach((z) => {
    for (let n = 1; n <= TEAMS_PER_ZONE; n++) {
      console.log(`  ${z.name} Team ${n}: ${z.id}.team${n}@cprs.gov.bd`);
    }
  });
}

seed().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
