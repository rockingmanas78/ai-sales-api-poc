export default function flatten(plans) {
  return plans.map(plan => {
    const version = plan.versions?.[0]; // Since you're using `take: 1`

    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,

      // Flatten version fields
      versionId: version?.id || null,
      version: version?.version || null,
      zone: version?.zone || null,
      bucket: version?.bucket || null,
      cadence: version?.cadence || null,

      // Include components
      components: version?.components || []
    };
  });
}
